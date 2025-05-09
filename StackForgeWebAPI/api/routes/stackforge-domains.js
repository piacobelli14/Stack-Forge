

const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const https = require('https');
const axios = require("axios");
const { authenticateToken } = require("../middleware/auth");
const { pool } = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const { 
  ElasticLoadBalancingV2Client, 
  DescribeListenersCommand, 
  DescribeRulesCommand, 
  DeleteRuleCommand, 
  CreateRuleCommand, 
  DescribeLoadBalancersCommand, 
  AddListenerCertificatesCommand,
  RemoveListenerCertificatesCommand, 
  DescribeListenerCertificatesCommand 
} = require('@aws-sdk/client-elastic-load-balancing-v2');
const { Route53Client, ChangeResourceRecordSetsCommand } = require('@aws-sdk/client-route-53'); const {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand
} = require("@aws-sdk/client-acm");
const { 
  CloudFrontClient, 
  CreateInvalidationCommand 
} = require('@aws-sdk/client-cloudfront');

const deployManager = require("./drivers/deployManager");

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

router.post("/validate-domain", authenticateToken, async (req, res, next) => {
    const {
      userID, organizationID, projectID, domain,
      repository, branch, rootDirectory, outputDirectory,
      buildCommand, installCommand, envVars,
      internalCall = false
    } = req.body;

    if (!userID || !organizationID || !projectID || !domain) {
      return res
        .status(400)
        .json({ message: "userID, organizationID, projectID, and domain are required." });
    }

    const timestamp = new Date().toISOString();
    const elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
    const r53 = new Route53Client({ region: process.env.AWS_REGION });
    const acm = new ACMClient({ region: process.env.AWS_REGION });
    const L_HTTPS = process.env.ALB_LISTENER_ARN_HTTPS;
    const L_HTTP = process.env.ALB_LISTENER_ARN_HTTP;
    const albDns = process.env.LOAD_BALANCER_DNS.endsWith(".")
      ? process.env.LOAD_BALANCER_DNS
      : `${process.env.LOAD_BALANCER_DNS}.`;

    const projRes = await pool.query(
      "SELECT name,current_deployment FROM projects WHERE project_id=$1 AND orgid=$2 AND username=$3",
      [projectID, organizationID, userID]
    );
    if (!projRes.rows.length)
      return res.status(404).json({ message: "Project not found." });

    const projectName = projRes.rows[0].name.toLowerCase();
    let deploymentId = projRes.rows[0].current_deployment || uuidv4();

    const parentRes = await pool.query(
      `SELECT d.repository,d.branch,d.root_directory,d.output_directory,
                d.build_command,d.install_command,d.env_vars,dep.task_def_arn
         FROM domains d
         JOIN deployments dep ON d.deployment_id = dep.deployment_id
         WHERE d.project_id=$1 AND d.is_primary=true`,
      [projectID]
    );
    const parentCfg = parentRes.rows[0] || {};

    let raw = domain.trim().toLowerCase()
      .replace(/\.stackforgeengine\.com$/i, "")
      .replace(new RegExp(`\\.${projectName}$`), "");
    const isParent = raw === projectName || raw === "";
    const subLabel = isParent ? projectName : raw.split(".")[0];
    const storedName = isParent ? projectName : `${subLabel}.${projectName}`;
    const fqdn = `${storedName}.stackforgeengine.com`;

    const domRes = await pool.query(
      `SELECT domain_id,certificate_arn,target_group_arn,redirect_target
         FROM domains
         WHERE project_id=$1 AND domain_name=$2`,
      [projectID, storedName]
    );
    const existing = domRes.rows[0] || null;
    const domainId = existing?.domain_id || uuidv4();
    let certArn = existing?.certificate_arn || null;
    let tgArn = existing?.target_group_arn || null;
    const existingRedirect = existing?.redirect_target || null;
    const wildcard = `*.${projectName}.stackforgeengine.com`;
    const altNames = [wildcard, `${projectName}.stackforgeengine.com`];

    if (!certArn) {
      const reqCert = await acm.send(
        new RequestCertificateCommand({
          DomainName: wildcard,
          SubjectAlternativeNames: altNames,
          ValidationMethod: "DNS"
        })
      );
      certArn = reqCert.CertificateArn;

      const certInfo = await acm.send(
        new DescribeCertificateCommand({ CertificateArn: certArn })
      );
      const rr = certInfo.Certificate.DomainValidationOptions?.[0]?.ResourceRecord;
      if (rr) {
        await r53.send(
          new ChangeResourceRecordSetsCommand({
            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
            ChangeBatch: {
              Changes: [
                {
                  Action: "UPSERT",
                  ResourceRecordSet: {
                    Name: rr.Name,
                    Type: rr.Type,
                    TTL: 300,
                    ResourceRecords: [{ Value: rr.Value }]
                  }
                }
              ]
            }
          })
        );
      }
    }

    let certReady = false;
    for (let i = 0; i < 12; i++) {
      const info = await acm.send(
        new DescribeCertificateCommand({ CertificateArn: certArn })
      );
      if (info.Certificate.Status === "ISSUED") {
        certReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 10_000));
    }
    if (!certReady) {
      return res.status(202).json({
        message:
          `Certificate request created for ${wildcard}. ` +
          `Please re‑run validation once DNS validation is complete.`,
        certificateArn: certArn
      });
    }

    const { Certificates } = await elbv2.send(
      new DescribeListenerCertificatesCommand({ ListenerArn: L_HTTPS })
    );
    if (!Certificates.some(c => c.CertificateArn === certArn)) {
      if (Certificates.length >= 25) {
        const victim = Certificates.find(c => !c.IsDefault);
        if (victim) {
          await elbv2.send(
            new RemoveListenerCertificatesCommand({
              ListenerArn: L_HTTPS,
              Certificates: [{ CertificateArn: victim.CertificateArn }]
            })
          );
        }
      }
      await elbv2.send(
        new AddListenerCertificatesCommand({
          ListenerArn: L_HTTPS,
          Certificates: [{ CertificateArn: certArn }]
        })
      );
    }

    let parsedEnv = envVars;
    try { if (typeof parsedEnv === "string") parsedEnv = JSON.parse(parsedEnv); } catch { parsedEnv = null; }

    const cfg = {
      repository: repository || parentCfg.repository || null,
      branch: branch || parentCfg.branch || "main",
      rootDirectory: rootDirectory || parentCfg.root_directory || ".",
      outputDirectory: outputDirectory || parentCfg.output_directory || "",
      buildCommand: buildCommand || parentCfg.build_command || "",
      installCommand: installCommand || parentCfg.install_command || "npm install",
      envVars: parsedEnv !== null
        ? parsedEnv
        : (parentCfg.env_vars ? JSON.parse(parentCfg.env_vars || "[]") : [])
    };

    async function upsertDns(host) {
      const isApex = host.split(".").length === 3;
      if (isApex) {
        const lb = await elbv2.send(
          new DescribeLoadBalancersCommand({ Names: [process.env.LOAD_BALANCER_NAME] })
        );
        await r53.send(
          new ChangeResourceRecordSetsCommand({
            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
            ChangeBatch: {
              Changes: [
                {
                  Action: "UPSERT",
                  ResourceRecordSet: {
                    Name: host,
                    Type: "A",
                    AliasTarget: {
                      HostedZoneId: lb.LoadBalancers[0].CanonicalHostedZoneId,
                      DNSName: albDns,
                      EvaluateTargetHealth: false
                    }
                  }
                }
              ]
            }
          })
        );
      } else {
        await r53.send(
          new ChangeResourceRecordSetsCommand({
            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
            ChangeBatch: {
              Changes: [
                {
                  Action: "UPSERT",
                  ResourceRecordSet: {
                    Name: host,
                    Type: "CNAME",
                    TTL: 60,
                    ResourceRecords: [{ Value: albDns }]
                  }
                }
              ]
            }
          })
        );
      }
    }
    await upsertDns(fqdn);

    if (!existingRedirect) {
      tgArn = tgArn || (await deployManager.ensureTargetGroup(projectName, isParent ? null : subLabel));

      for (const L of [L_HTTP, L_HTTPS]) {
        const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: L }));
        const missing = !Rules.some(r =>
          r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn))
        );
        if (missing) {
          const used = new Set(Rules.filter(r => !r.IsDefault).map(r => +r.Priority));
          let pr = 1; while (used.has(pr)) pr++;
          await elbv2.send(
            new CreateRuleCommand({
              ListenerArn: L,
              Priority: pr,
              Conditions: [{ Field: "host-header", Values: [fqdn] }],
              Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
            })
          );
        }
      }

      if (!internalCall) {
        await deployManager.createOrUpdateService({
          projectName,
          subdomain: isParent ? null : subLabel,
          taskDefArn: parentCfg.task_def_arn,
          targetGroupArn: tgArn
        });
      }
    } 

    const valsCommon = [
      timestamp,
      deploymentId,
      certArn,
      cfg.repository,
      cfg.branch,
      cfg.rootDirectory,
      cfg.outputDirectory,
      cfg.buildCommand,
      cfg.installCommand,
      JSON.stringify(cfg.envVars),
      tgArn
    ];
    if (existing) {
      await pool.query(
        `UPDATE domains SET
             updated_at       = $1,
             deployment_id    = $2,
             certificate_arn  = $3,
             repository       = $4,
             branch           = $5,
             root_directory   = $6,
             output_directory = $7,
             build_command    = $8,
             install_command  = $9,
             env_vars         = $10,
             target_group_arn = $11
           WHERE domain_id = $12`,
        [...valsCommon, domainId]
      );
    } else {
      await pool.query(
        `INSERT INTO domains (
             orgid,username,domain_id,domain_name,project_id,
             created_by,created_at,updated_at,environment,is_primary,
             deployment_id,certificate_arn,repository,branch,root_directory,
             output_directory,build_command,install_command,env_vars,target_group_arn
           ) VALUES (
             $1,$2,$3,$4,$5,
             $6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20
           )`,
        [
          organizationID,
          userID,
          domainId,
          storedName,
          projectID,
          userID,
          timestamp,
          timestamp,
          "production",
          isParent,
          deploymentId,
          certArn,
          cfg.repository,
          cfg.branch,
          cfg.rootDirectory,
          cfg.outputDirectory,
          cfg.buildCommand,
          cfg.installCommand,
          JSON.stringify(cfg.envVars),
          tgArn
        ]
      );
    }

    const recs = [];
    try { const a = await dns.resolve4(fqdn); if (a.length) recs.push({ type: "A", name: "@", value: a[0] }); } catch { }
    try { const a = await dns.resolve6(fqdn); if (a.length) recs.push({ type: "AAAA", name: "@", value: a[0] }); } catch { }
    try { const c = await dns.resolveCname(fqdn); if (c.length) recs.push({ type: "CNAME", name: "@", value: c[0] }); } catch { }
    try { const m = await dns.resolveMx(fqdn); if (m.length) recs.push({ type: "MX", name: "@", value: m.map(r => `${r.priority} ${r.exchange}`).join(", ") }); } catch { }
    await pool.query(
      "UPDATE domains SET dns_records=$1 WHERE domain_id=$2",
      [JSON.stringify(recs), domainId]
    );

    return res.status(200).json({
      message: existingRedirect
        ? `Subdomain ${subLabel} refreshed (redirect still → ${existingRedirect}).`
        : `Subdomain ${subLabel} validated${existing ? "" : " and deployment initiated"}.`,
      url: `https://${fqdn}`,
      certificateArn: certArn,
      dnsRecords: recs
    });
  }
);

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
                environment, 
                deployment_id
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
      environment: domain.environment,
      deploymentID: domain.deployment_id
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

  if (!userID || !organizationID || !projectID || !domainID) {
    return res.status(400).json({
      message: "userID, organizationID, projectID, and domainID are required."
    });
  }

  const elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
  const cloudfront = new CloudFrontClient({ region: process.env.AWS_REGION });
  const route53Client = new Route53Client({ region: process.env.AWS_REGION });
  const lbDns = process.env.LOAD_BALANCER_DNS.endsWith(".")
    ? process.env.LOAD_BALANCER_DNS
    : `${process.env.LOAD_BALANCER_DNS}.`;
  const httpsArn = process.env.ALB_LISTENER_ARN_HTTPS;
  const httpArn = process.env.ALB_LISTENER_ARN_HTTP;

  async function getFreePriority(listenerArn) {
    const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
    const used = Rules.filter(r => !r.IsDefault).map(r => parseInt(r.Priority));
    for (let p = 1; p <= 50000; p++) if (!used.includes(p)) return p;
    throw new Error("No free ALB rule priority available.");
  }

  async function upsertRecord(fqdn) {
    const isApex = fqdn.split(".").length === 3;
    if (!isApex) {
      await route53Client.send(new ChangeResourceRecordSetsCommand({
        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
        ChangeBatch: {
          Changes: [{
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: fqdn,
              Type: "CNAME",
              TTL: 60,
              ResourceRecords: [{ Value: lbDns }]
            }
          }]
        }
      }));
      return;
    }

    let hostedZoneId;
    if (process.env.LOAD_BALANCER_NAME) {
      const { LoadBalancers } = await elbv2.send(
        new DescribeLoadBalancersCommand({ Names: [process.env.LOAD_BALANCER_NAME] })
      );
      hostedZoneId = LoadBalancers[0].CanonicalHostedZoneId;
    } else {
      const { Listeners } = await elbv2.send(
        new DescribeListenersCommand({ ListenerArns: [httpsArn] })
      );
      const lbArn = Listeners[0].LoadBalancerArn;
      const { LoadBalancers } = await elbv2.send(
        new DescribeLoadBalancersCommand({ LoadBalancerArns: [lbArn] })
      );
      hostedZoneId = LoadBalancers[0].CanonicalHostedZoneId;
    }

    await route53Client.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
      ChangeBatch: {
        Changes: [{
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: fqdn,
            Type: "A",
            AliasTarget: {
              HostedZoneId: hostedZoneId,
              DNSName: lbDns,
              EvaluateTargetHealth: false
            }
          }
        }]
      }
    }));
  }

  try {
    const [projRes, domRes, parentRes] = await Promise.all([
      pool.query(
        "SELECT name FROM projects WHERE project_id=$1 AND orgid=$2 AND username=$3",
        [projectID, organizationID, userID]
      ),
      pool.query(
        "SELECT domain_name,target_group_arn FROM domains WHERE domain_id=$1 AND project_id=$2 AND orgid=$3",
        [domainID, projectID, organizationID]
      ),
      pool.query(
        `SELECT dep.task_def_arn FROM domains d
         JOIN deployments dep ON dep.deployment_id = d.deployment_id
         WHERE d.project_id=$1 AND d.is_primary=true LIMIT 1`,
        [projectID]
      )
    ]);
    if (!projRes.rows.length || !domRes.rows.length)
      return res.status(404).json({ message: "Project or domain not found." });

    const projectName = projRes.rows[0].name.toLowerCase();
    const sourceSub = domRes.rows[0].domain_name.toLowerCase(); 
    const sourceFqdn = `${sourceSub}.stackforgeengine.com`;
    let tgArn = domRes.rows[0].target_group_arn || null;
    const parentTaskDef = parentRes.rows[0]?.task_def_arn || null;
    const isApex = sourceSub === projectName;

    await upsertRecord(sourceFqdn);

    let targetFqdn = null;
    if (redirectTarget !== null) {
      let t = redirectTarget.trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (t.endsWith(".stackforgeengine.com"))
        t = t.replace(/\.stackforgeengine\.com$/i, "");

      if (t === projectName) {
      } else if (!t.includes(".")) {
        t = `${t}.${projectName}`;
      }
      targetFqdn = `${t}.stackforgeengine.com`;
      await upsertRecord(targetFqdn);
    }

    for (const arn of [httpArn, httpsArn]) {
      const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: arn }));
      for (const r of Rules) {
        if (!r.IsDefault &&
          r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(sourceFqdn))) {
          await elbv2.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
        }
      }
    }

    if (redirectTarget === null) {
      if (!tgArn) {
        tgArn = await deployManager.ensureTargetGroup(
          projectName, isApex ? null : sourceSub.split(".")[0]
        );
        await pool.query(
          "UPDATE domains SET target_group_arn=$1 WHERE domain_id=$2",
          [tgArn, domainID]
        );
      }

      if (parentTaskDef) {
        await deployManager.createOrUpdateService({
          projectName,
          subdomain: isApex ? null : sourceSub.split(".")[0],
          taskDefArn: parentTaskDef,
          targetGroupArn: tgArn
        });
      }

      for (const arn of [httpArn, httpsArn]) {
        const prio = await getFreePriority(arn);
        await elbv2.send(new CreateRuleCommand({
          ListenerArn: arn,
          Priority: prio,
          Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
          Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
        }));
      }

      await pool.query(
        "UPDATE domains SET redirect_target=NULL, updated_at=$1 WHERE domain_id=$2",
        [new Date().toISOString(), domainID]
      );

      if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
        await cloudfront.send(new CreateInvalidationCommand({
          DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `redirect-remove-${domainID}-${Date.now()}`,
            Paths: { Quantity: 1, Items: ["/*"] }
          }
        }));
      }

      return res.json({ success: true, message: "Redirect removed & host restored." });
    }

    for (const arn of [httpArn, httpsArn]) {
      const prio = await getFreePriority(arn);
      await elbv2.send(new CreateRuleCommand({
        ListenerArn: arn,
        Priority: prio,
        Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
        Actions: [{
          Type: "redirect",
          RedirectConfig: {
            Protocol: "HTTPS",
            Port: "443",
            Host: targetFqdn,
            Path: "/",
            Query: "",
            StatusCode: "HTTP_302"
          }
        }]
      }));
    }

    await pool.query(
      "UPDATE domains SET redirect_target=$1, updated_at=$2 WHERE domain_id=$3",
      [targetFqdn.replace(/\.stackforgeengine\.com$/i, ""), new Date().toISOString(), domainID]
    );

    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      await cloudfront.send(new CreateInvalidationCommand({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: `redirect-${domainID}-${Date.now()}`,
          Paths: { Quantity: 2, Items: ["/", "/*"] }
        }
      }));
    }

    return res.json({ success: true, message: "Redirect updated." });

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ message: `Failed to update redirect rules: ${err.message}.` });
    }
    next(err);
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