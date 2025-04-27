const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const axios = require("axios");
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const {
    Route53Client,
    ChangeResourceRecordSetsCommand
} = require("@aws-sdk/client-route-53");

const deployManager = require("./drivers/deployManager");
const route53Client = new Route53Client({ region: process.env.AWS_REGION });

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

router.post("/validate-domain", authenticateToken, async (req, res, next) => {
    const https = require('https');
    const { ACMClient, RequestCertificateCommand, DescribeCertificateCommand } = require("@aws-sdk/client-acm");
    const { AddListenerCertificatesCommand, DescribeListenersCommand } = require("@aws-sdk/client-elastic-load-balancing-v2");
    const { userID, organizationID, projectID, domain } = req.body;

    if (!userID || !organizationID || !projectID || !domain) {
        return res.status(400).json({ message: "userID, organizationID, projectID, and domain are required." });
    }

    const acmClient = new ACMClient({ region: process.env.AWS_REGION });

    try {
        const projectResult = await pool.query(
            "SELECT name FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ message: "Project not found or access denied." });
        }
        const projectName = projectResult.rows[0].name.toLowerCase();
        let rawSubdomain = domain.trim().toLowerCase();
        const baseDomain = ".stackforgeengine.com";
        if (rawSubdomain.endsWith(baseDomain)) {
            rawSubdomain = rawSubdomain.slice(0, -baseDomain.length);
        }

        const suffix = `.${projectName}`;
        while (rawSubdomain.endsWith(suffix)) {
            rawSubdomain = rawSubdomain.slice(0, -suffix.length);
        }

        const isParentDomain = rawSubdomain === projectName || rawSubdomain === "";
        if (isParentDomain) {
            rawSubdomain = projectName;
        }

        const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
        if (!hostnameRegex.test(rawSubdomain)) {
            return res
                .status(400)
                .json({ message: "Invalid subdomain format. Use only alphanumeric characters and hyphens." });
        }

        const expectedSubdomain = isParentDomain ? projectName : `${rawSubdomain}.${projectName}`;
        const fqdn = `${expectedSubdomain}.stackforgeengine.com`;
        let certificateArn = null;
        const wildcardDomain = `*.${projectName}.stackforgeengine.com`;
        const existingCertResult = await pool.query(
            "SELECT certificate_arn FROM domains WHERE project_id = $1 AND certificate_arn IS NOT NULL",
            [projectID]
        );
        if (existingCertResult.rows.length > 0) {
            certificateArn = existingCertResult.rows[0].certificate_arn;

            const certDetails = await acmClient.send(new DescribeCertificateCommand({
                CertificateArn: certificateArn,
            }));
            if (certDetails.Certificate.Status !== "ISSUED") {
                throw new Error(`Certificate not issued, status: ${certDetails.Certificate.Status}.`);
            }
        } else {
            const certRequest = await acmClient.send(new RequestCertificateCommand({
                DomainName: wildcardDomain,
                ValidationMethod: "DNS",
                SubjectAlternativeNames: [wildcardDomain],
            }));
            certificateArn = certRequest.CertificateArn;
            await new Promise(resolve => setTimeout(resolve, 5000));
            const certDetails = await acmClient.send(new DescribeCertificateCommand({
                CertificateArn: certificateArn,
            }));
            const validationOptions = certDetails.Certificate.DomainValidationOptions;

            if (validationOptions && validationOptions.length > 0) {
                const validationRecord = validationOptions[0].ResourceRecord;
                if (validationRecord) {
                    const changeBatch = {
                        Changes: [{
                            Action: "UPSERT",
                            ResourceRecordSet: {
                                Name: validationRecord.Name,
                                Type: validationRecord.Type,
                                TTL: 300,
                                ResourceRecords: [{ Value: validationRecord.Value }],
                            },
                        }],
                    };
                    await route53Client.send(new ChangeResourceRecordSetsCommand({
                        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                        ChangeBatch: changeBatch,
                    }));
                }
            }

            let certStatus = "PENDING_VALIDATION";
            const maxWaitTime = 5 * 60 * 1000;
            const startTime = Date.now();
            while (certStatus === "PENDING_VALIDATION" && Date.now() - startTime < maxWaitTime) {
                const certCheck = await acmClient.send(new DescribeCertificateCommand({
                    CertificateArn: certificateArn,
                }));
                certStatus = certCheck.Certificate.Status;
                if (certStatus === "ISSUED") break;
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
            if (certStatus !== "ISSUED") {
                throw new Error(`Certificate validation timed out, status: ${certStatus}.`);
            }
        }

        const listenerResp = await deployManager.elbv2.send(new DescribeListenersCommand({
            ListenerArns: [process.env.ALB_LISTENER_ARN_HTTPS],
        }));
        const attachedCerts = listenerResp.Listeners[0].Certificates.map(c => c.CertificateArn);
        if (!attachedCerts.includes(certificateArn)) {
            await deployManager.elbv2.send(new AddListenerCertificatesCommand({
                ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                Certificates: [{ CertificateArn: certificateArn }],
            }));
        } else {}

        let domainID;
        const existing = await pool.query(
            "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
            [projectID, expectedSubdomain]
        );
        const timestamp = new Date().toISOString();

        if (existing.rows.length > 0) {
            domainID = existing.rows[0].domain_id;
            await pool.query(
                `UPDATE domains
                 SET updated_at = $1,
                     is_primary = $2,
                     certificate_arn = $3
                 WHERE domain_id = $4`,
                [timestamp, isParentDomain, certificateArn, domainID]
            );
        } else {
            domainID = uuidv4();
            await pool.query(
                `INSERT INTO domains (
                     orgid, username, domain_id, domain_name, project_id,
                     created_by, created_at, updated_at,
                     environment, is_primary, certificate_arn
                 ) VALUES (
                     $1, $2, $3, $4, $5,
                     $6, $7, $8,
                     $9, $10, $11
                 )`,
                [
                    organizationID,
                    userID,
                    domainID,
                    expectedSubdomain,
                    projectID,
                    userID,
                    timestamp,
                    timestamp,
                    "production",
                    isParentDomain,
                    certificateArn,
                ]
            );
        }

        const domainResult = await pool.query(
            "SELECT domain_name FROM domains WHERE project_id = $1 AND orgid = $2",
            [projectID, organizationID]
        );
        const subdomains = domainResult.rows
            .map((row) => row.domain_name.split(".")[0])
            .filter((sub) => sub !== projectName);

        await deployManager.updateDNSRecord(projectName, subdomains);

        const targetGroupArn = await deployManager.ensureTargetGroup(projectName);
        await deployManager.createOrUpdateService({
            projectName,
            taskDefArn: null,
            targetGroupArn,
        });

        const result = {
            domain: fqdn,
            isAccessible: false,
            statusCode: null,
            dnsRecords: [],
            checkedAt: timestamp,
            status: "pending",
            certificateArn: certificateArn,
        };

        try {
            const aRecords = await dns.resolve4(fqdn);
            if (aRecords.length) result.dnsRecords.push({ type: "A", name: "@", value: aRecords[0] });
        } catch (error) {}
        try {
            const aaaaRecords = await dns.resolve6(fqdn);
            if (aaaaRecords.length) result.dnsRecords.push({ type: "AAAA", name: "@", value: aaaaRecords[0] });
        } catch (error) {}
        try {
            const cnameRecords = await dns.resolveCname(fqdn);
            if (cnameRecords.length) result.dnsRecords.push({ type: "CNAME", name: "@", value: cnameRecords[0] });
        } catch (error) {}
        try {
            const mxRecords = await dns.resolveMx(fqdn);
            if (mxRecords.length)
                result.dnsRecords.push({
                    type: "MX",
                    name: "@",
                    value: mxRecords.map((r) => `${r.priority} ${r.exchange}`).join(", "),
                });
        } catch (error) {}

        const httpAgent = new https.Agent({
            rejectUnauthorized: false,
        });
        const maxRetries = 5;
        let retryCount = 0;
        while (retryCount < maxRetries) {
            try {
                const response = await axios.head(`https://${fqdn}`, {
                    timeout: 5000,
                    validateStatus: null,
                    httpsAgent: httpAgent,
                });
                result.isAccessible = response.status >= 200 && response.status < 400;
                result.statusCode = response.status;
                result.status = result.isAccessible ? "accessible" : "inaccessible";
                break;
            } catch (error) {
                try {
                    const response = await axios.head(`http://${fqdn}`, { timeout: 5000, validateStatus: null });
                    result.isAccessible = response.status >= 200 && response.status < 400;
                    result.statusCode = response.status;
                    result.status = result.isAccessible ? "accessible" : "inaccessible";
                    break;
                } catch (error2) {}
            }
            retryCount++;
            if (retryCount < maxRetries) {
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }
        }

        if (!result.isAccessible && result.dnsRecords.length === 0) {
            result.status = "pending";
        }

        await pool.query(
            `UPDATE domains
             SET is_accessible = $1,
                 dns_records = $2,
                 checked_at = $3,
                 updated_at = $4,
                 certificate_arn = $5
             WHERE domain_id = $6`,
            [result.isAccessible, JSON.stringify(result.dnsRecords), result.checkedAt, timestamp, certificateArn, domainID]
        );

        res.status(200).json(result);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to validate domain: ${error.message}.` });
        }
        next(error);
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
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to retrieve domains: ${error.message}.` });
        }
        next(error);
    }
});


module.exports = router;