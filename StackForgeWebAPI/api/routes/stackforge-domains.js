const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const axios = require("axios");
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

router.post("/validate-domain", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domain } = req.body;

    if (!domain) {
        return res.status(400).json({ message: "Domain is required" });
    }

    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    const fqdnRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!(hostnameRegex.test(domain) || fqdnRegex.test(domain))) {
        return res.status(400).json({ message: "Invalid domain format" });
    }

    try {
        const result = {
            domain,
            isAccessible: false,
            statusCode: null,
            dnsRecords: [],
            checkedAt: new Date().toISOString(),
        };

        try {
            const a = await dns.resolve4(domain);
            if (a.length) {
                result.dnsRecords.push({ 
                    type: "A", 
                    name: "@", 
                    value: a[0] 
                });
            }

            const aaaa = await dns.resolve6(domain);
            if (aaaa.length) {
                result.dnsRecords.push({ 
                    type: "AAAA", 
                    name: "@", 
                    value: aaaa[0] 
                });
            }

            const c = await dns.resolveCname(domain);
            if (c.length) {
                result.dnsRecords.push({ 
                    type: "CNAME", 
                    name: "@", 
                    value: c[0] 
                });
            }

            const m = await dns.resolveMx(domain);
            if (m.length) {
                result.dnsRecords.push({
                    type: "MX",
                    name: "@",
                    value: m.map(r => `${r.priority} ${r.exchange}`).join(", ") 
                });
            }
        } catch (e) {}

        try {
            const r = await axios.head(`https://${domain}`, { timeout: 5000, validateStatus: null });
            result.isAccessible = true;
            result.statusCode = r.status;
        } catch {
            try {
                const r2 = await axios.head(`http://${domain}`, { timeout: 5000, validateStatus: null });
                result.isAccessible = true;
                result.statusCode = r2.status;
            } catch (e2) {}
        }

        const domainID = uuidv4();

        await pool.query(
            `DELETE FROM domains
            WHERE orgid = $1
            AND username = $2
            AND project_id = $3
            AND domain_name = $4`,
            [organizationID, userID, projectID, domain]
        );

        await pool.query(
            `INSERT INTO domains (
            orgid,
            username,
            domain_id,
            domain_name,
            project_id,
            created_by,
            created_at,
            updated_at,
            is_accessible,
            dns_records,
            checked_at,
            environment,
            is_primary,
            redirect_target
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, NOW(), NOW(),
            $7, $8, $9,
            $10, $11, $12
        )`,
            [
                organizationID,
                userID,
                domainID,
                domain,
                projectID,
                userID,
                result.isAccessible,
                JSON.stringify(result.dnsRecords),
                result.checkedAt,
                'production',
                false,
                null,
            ]
        );

        res.status(200).json(result);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to validate domain: ${err.message}.` });
        }
        next(err);
    }
});

router.post("/project-domains", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID } = req.body;

    if (!userID || !organizationID || !projectID) {
        return res.status(400).json({ 
            message: "userID, organizationID, and projectID are required." 
        });
    }

    try {
        const domainFetchQuery = `
            SELECT 
                domain_id,
                domain_name,
                project_id,
                created_by,
                created_at,
                updated_at,
                is_accessible,
                dns_records,
                checked_at,
                is_primary,
                redirect_target, 
                environment
            FROM domains
            WHERE orgid = $1
            AND username = $2
            AND project_id = $3
        `;
        
        const domainFetchInfo = await pool.query(domainFetchQuery, [organizationID, userID, projectID]);
        const domains = domainFetchInfo.rows.map(domain => ({
            domainID: domain.domain_id,
            domainName: domain.domain_name,
            projectID: domain.project_id,
            createdBy: domain.created_by,
            createdAt: domain.created_at,
            updatedAt: domain.updated_at,
            isAccessible: domain.is_accessible,
            dnsRecords: domain.dns_records,
            checkedAt: domain.checked_at,
            isPrimary: domain.is_primary,
            redirectTarget: domain.redirect_target, 
            environment: domain.environment
        }));

        res.status(200).json({
            domains: domains,
            count: domains.length
        });
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({message: `Failed to retrieve domains: ${err.message}.`});
        }
        next(err);
    }
});

router.post("/edit-redirect", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domainID, redirectTarget } = req.body;

    if (!userID || !organizationID || !projectID || !domainID || !redirectTarget) {
        return res.status(400).json({ 
            message: "userID, organizationID, projectID, domainID, and environment are required." 
        });
    }

    try {
        const updateRedirectQuery = `
            UPDATE domains
            SET redirect_target = $1,
                updated_at = NOW()
            WHERE orgid = $2
            AND username = $3
            AND project_id = $4
            AND domain_id = $5
        `;

        const { rowCount } = await pool.query(updateRedirectQuery, [redirectTarget, organizationID, userID, projectID, domainID]);

        if (rowCount === 0) {
            return res.status(404).json({ message: "Domain not found." });
        }

        res.status(200).json({ message: "Environment updated successfully." });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to update redirection: ${error.message}.` });
        }
        next(error);
    }
});

router.post("/edit-environment", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domainID, environment } = req.body;

    if (!userID || !organizationID || !projectID || !domainID || !environment) {
        return res.status(400).json({ 
            message: "userID, organizationID, projectID, domainID, and environment are required." 
        });
    }

    try {
        const updateEnvironmentQuery = `
            UPDATE domains
            SET environment = $1,
                updated_at = NOW()
            WHERE orgid = $2
            AND username = $3
            AND project_id = $4
            AND domain_id = $5
        `;

        const { rowCount } = await pool.query(updateEnvironmentQuery, [environment, organizationID, userID, projectID, domainID]);

        if (rowCount === 0) {
            return res.status(404).json({ message: "Domain not found." });
        }

        res.status(200).json({ message: "Environment updated successfully." });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to update environment: ${error.message}.` });
        }
        next(error);
    }
});

module.exports = router;