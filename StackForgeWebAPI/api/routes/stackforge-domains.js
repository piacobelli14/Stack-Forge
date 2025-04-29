const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const axios = require("axios");
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const { ElasticLoadBalancingV2Client, DescribeListenersCommand, DescribeRulesCommand, DeleteRuleCommand, CreateRuleCommand } = require('@aws-sdk/client-elastic-load-balancing-v2');
const { WAFV2Client, GetWebACLForResourceCommand, UpdateWebACLCommand } = require('@aws-sdk/client-wafv2');
const { Route53Client, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand } = require('@aws-sdk/client-route-53');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { google } = require('googleapis');

const deployManager = require("./drivers/deployManager");
const route53Client = new Route53Client({ region: process.env.AWS_REGION });

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS
});
const analyticsDataClient = google.analyticsdata('v1beta');

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

router.post("/edit-redirect", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domainID, redirectTarget } = req.body;

    const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
    const cloudfrontClient = new CloudFrontClient({ region: process.env.AWS_REGION });

    if (!userID || !organizationID || !projectID || !domainID) {
        return res.status(400).json({ message: "All required fields must be provided." });
    }

    try {
        if (redirectTarget === null) {
            const targetListenerArns = [
                process.env.ALB_LISTENER_ARN_HTTPS,
                process.env.ALB_LISTENER_ARN_HTTP
            ];
            await Promise.all(targetListenerArns.map(async (listenerArn) => {
                const rulesResp = await elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                await Promise.all(
                    rulesResp.Rules
                        .filter(rule => !rule.IsDefault)
                        .map(rule => elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })))
                );
            }));

            const timestamp = new Date().toISOString();
            await pool.query(
                `UPDATE domains
                 SET redirect_target = NULL,
                     updated_at = $1
                 WHERE domain_id = $2`,
                [timestamp, domainID]
            );

            if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
                await cloudfrontClient.send(new CreateInvalidationCommand({
                    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                    InvalidationBatch: {
                        CallerReference: `redirect-remove-${domainID}-${Date.now()}`,
                        Paths: { Quantity: 2, Items: ['/*', '/'] }
                    }
                }));
            }

            return res.status(200).json({ success: true, message: "Redirect removed" });
        }

        const [projectResult, domainResult] = await Promise.all([
            pool.query(
                "SELECT name FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                [projectID, organizationID, userID]
            ),
            pool.query(
                "SELECT domain_name FROM domains WHERE domain_id = $1 AND project_id = $2 AND orgid = $3",
                [domainID, projectID, organizationID]
            )
        ]);

        if (projectResult.rows.length === 0 || domainResult.rows.length === 0) {
            return res.status(404).json({ message: "Project or domain not found." });
        }

        const projectName = projectResult.rows[0].name.toLowerCase();
        const domainName = domainResult.rows[0].domain_name;
        const fullFqdn = `${domainName}.stackforgeengine.com`.toLowerCase().replace(/\.$/, '');

        const targetSubdomain = redirectTarget.replace('.stackforgeengine.com', '');
        if (targetSubdomain === domainName) {
            return res.status(400).json({ message: "Cannot redirect to same domain." });
        }

        const redirectFqdn = `${targetSubdomain}.stackforgeengine.com`.toLowerCase().replace(/\.$/, '');
        const changeFingerprint = `v=${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const cacheBuster = `cb=${uuidv4()}`;
        const fullQueryString = `${changeFingerprint}&${cacheBuster}`;

        const nuclearHeaders = [
            { Name: "Cache-Control", Value: "private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0" },
            { Name: "Pragma",        Value: "no-cache" },
            { Name: "Expires",       Value: "0" },
            { Name: "X-Accel-Expires", Value: "0" },
            { Name: "Edge-Control",  Value: "no-store" },
            { Name: "CDN-Cache-Control", Value: "no-store" },
            { Name: "X-Cache-Bust",  Value: changeFingerprint }
        ];

        const targetListenerArns = [
            process.env.ALB_LISTENER_ARN_HTTPS,
            process.env.ALB_LISTENER_ARN_HTTP
        ];

        await Promise.all(targetListenerArns.map(async (listenerArn) => {
            const rulesResp = await elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
            await Promise.all(
                rulesResp.Rules
                    .filter(rule => !rule.IsDefault)
                    .map(rule => elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })))
            );
        }));

        await Promise.all(targetListenerArns.map(async (listenerArn) => {
            await elbv2Client.send(new CreateRuleCommand({
                ListenerArn: listenerArn,
                Priority: 1,
                Conditions: [{ Field: "host-header", Values: [fullFqdn] }],
                Actions: [{
                    Type: "redirect",
                    RedirectConfig: {
                        Protocol:    "HTTPS",
                        Port:        "443",
                        StatusCode:  "HTTP_302",
                        Host:        redirectFqdn,
                        Path:        "/#{path}",
                        Query:       `#{query}&${fullQueryString}`,
                        Headers:     nuclearHeaders
                    }
                }]
            }));
        }));

        const timestamp = new Date().toISOString();
        await pool.query(
            `UPDATE domains
             SET redirect_target = $1,
                 updated_at     = $2
             WHERE domain_id    = $3`,
            [targetSubdomain, timestamp, domainID]
        );

        if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
            await cloudfrontClient.send(new CreateInvalidationCommand({
                DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                InvalidationBatch: {
                    CallerReference: `redirect-${domainID}-${Date.now()}`,
                    Paths: { Quantity: 2, Items: ['/*', '/'] }
                }
            }));
        }

        res.status(200).json({
            success: true,
            message: "Redirect updated with nuclear cache-busting",
            technicalDetails: {
                sourceDomain: fullFqdn,
                targetDomain: redirectFqdn,
                cacheBusters: { fingerprint: changeFingerprint, uuid: cacheBuster },
                immediateTestUrl: `https://${fullFqdn}/?${fullQueryString}`,
                headersToVerify: nuclearHeaders,
                troubleshooting: [
                    "1. Clear browser cache completely (Ctrl+Shift+Del)",
                    "2. Test in incognito window first",
                    "3. Use curl:",
                    `   curl -v -H "Host: ${fullFqdn}" "https://${process.env.LOAD_BALANCER_DNS}/?${fullQueryString}"`
                ]
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Redirect update failed",
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            troubleshootingTips: [
                "Check CloudFront configuration",
                "Verify ALB listener rules in AWS console",
                "Test via ALB DNS:",
                `curl -v -H "Host: ${req.body.domainID}.stackforgeengine.com" http://${process.env.LOAD_BALANCER_DNS}`
            ]
        });
    }
});

router.post("/edit-environment", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domainID, environment } = req.body;

    if (!userID || !organizationID || !projectID || !domainID || !environment) {
        return res.status(400).json({ message: "userID, organizationID, projectID, domainID, and environment are required." });
    }

    const validEnvironments = ["Production", "Preview"];
    if (!validEnvironments.includes(environment)) {
        return res.status(400).json({ message: "Environment must be 'Production' or 'Preview'." });
    }

    try {
        const projectResult = await pool.query(
            "SELECT name FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ message: "Project not found or access denied." });
        }
        const projectName = projectResult.rows[0].name.toLowerCase();

        const domainResult = await pool.query(
            "SELECT domain_name FROM domains WHERE domain_id = $1 AND project_id = $2 AND orgid = $3",
            [domainID, projectID, organizationID]
        );
        if (domainResult.rows.length === 0) {
            return res.status(404).json({ message: "Domain not found or access denied." });
        }

        const timestamp = new Date().toISOString();
        await pool.query(
            `UPDATE domains
             SET environment = $1,
                 updated_at = $2
             WHERE domain_id = $3`,
            [environment, timestamp, domainID]
        );

        await pool.query(
            `INSERT INTO deployment_logs
             (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [organizationID, userID, projectID, projectName, "edit_environment", uuidv4(), timestamp, "127.0.0.1"]
        );

        res.status(200).json({ message: "Environment updated successfully.", environment });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: `Failed to update environment: ${error.message}.` });
        }
        next(error);
    }
});

module.exports = router;
