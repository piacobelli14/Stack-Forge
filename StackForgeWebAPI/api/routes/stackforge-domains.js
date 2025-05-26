

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
  CreateRuleCommand,
  DeleteRuleCommand,
  DescribeLoadBalancersCommand,
  AddListenerCertificatesCommand,
  RemoveListenerCertificatesCommand,
  DescribeListenerCertificatesCommand,
  DescribeTargetHealthCommand,
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
  const { userID, organizationID, projectID, domain, repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, internalCall = false } = req.body;

  if (!userID || !organizationID || !projectID || !domain) {
    return res
      .status(400)
      .json({ message: "userID, organizationID, projectID, and domain are required." });
  }

  const timestamp = new Date().toISOString();
  const elbv2  = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
  const r53    = new Route53Client({ region: process.env.AWS_REGION });
  const acm    = new ACMClient({ region: process.env.AWS_REGION });
  const L_HTTPS = process.env.ALB_LISTENER_ARN_HTTPS;
  const L_HTTP  = process.env.ALB_LISTENER_ARN_HTTP;
  const albDns  = process.env.LOAD_BALANCER_DNS.endsWith(".")
    ? process.env.LOAD_BALANCER_DNS
    : `${process.env.LOAD_BALANCER_DNS}.`;

  const projResult = await pool.query(
    `SELECT name, current_deployment, created_at
       FROM projects
      WHERE project_id = $1
        AND orgid      = $2
        AND username   = $3`,
    [projectID, organizationID, userID]
  );
  if (!projResult.rows.length)
    return res.status(404).json({ message: "Project not found." });

  const projectName        = projResult.rows[0].name.toLowerCase();
  const currentDeployment  = projResult.rows[0].current_deployment;

  const parentResult = await pool.query(
    `SELECT dep.env_vars,
            d.repository, d.branch, d.root_directory, d.output_directory,
            d.build_command, d.install_command,
            dep.task_def_arn
       FROM domains d
       JOIN deployments dep ON d.deployment_id = dep.deployment_id
      WHERE d.project_id = $1
        AND d.is_primary = true`,
    [projectID]
  );
  let parentCfg = parentResult.rows[0] || {};
  let parentRawEnv = parentCfg.env_vars;

  if (parentRawEnv === undefined || parentRawEnv === null) {
    const fallbackRes = await pool.query(
      `SELECT dep.env_vars
         FROM deployments dep
         JOIN domains d ON dep.deployment_id = d.deployment_id
        WHERE d.project_id = $1
          AND d.is_primary = true`,
      [projectID]
    );
    parentRawEnv = fallbackRes.rows[0]?.env_vars || [];
  }

  let fallbackEnvVars = [];
  if (typeof parentRawEnv === "string") {
    try { fallbackEnvVars = JSON.parse(parentRawEnv); } catch { fallbackEnvVars = []; }
  } else if (Array.isArray(parentRawEnv)) {
    fallbackEnvVars = parentRawEnv;
  }

  let raw = domain.trim().toLowerCase()
    .replace(/\.stackforgeengine\.com$/i, "")
    .replace(new RegExp(`\\.${projectName}$`), "");
  const isParent   = raw === projectName || raw === "";
  const subLabel   = isParent ? projectName : raw.split(".")[0];
  const storedName = isParent ? projectName : `${subLabel}.${projectName}`;
  const fqdn       = `${storedName}.stackforgeengine.com`;

  const domResult = await pool.query(
    `SELECT domain_id, certificate_arn, target_group_arn,
            redirect_target, deployment_id
       FROM domains
      WHERE project_id = $1
        AND domain_name = $2`,
    [projectID, storedName]
  );
  const existing = domResult.rows[0] || null;

  const projectAgeMs = Date.now() - new Date(projRes.rows[0].created_at + 'Z').getTime();
  const delayMs = 300_000;
  if (!existing && projectAgeMs < delayMs) {
      const waitSec = Math.ceil((delayMs - projectAgeMs) / 1000);
      return res.status(429).json({
          code: "DOMAIN_THROTTLED",
          message: `New domains may be added starting five minutes after project creation. ` +
                  `Please wait approximately ${waitSec} more second${waitSec !== 1 ? "s" : ""} ` +
                  `and try again.`
      });
  }

  const domainId = existing?.domain_id || uuidv4();
  let   certArn = existing?.certificate_arn || null;
  let   tgArn = existing?.target_group_arn || null;
  const existingRedirect = existing?.redirect_target || null;
  const existingDeploymentId = existing?.deployment_id || null;

  const wildcard  = `*.${projectName}.stackforgeengine.com`;
  const altNames  = [wildcard, `${projectName}.stackforgeengine.com`];

  let   deploymentId = isParent
    ? (existingDeploymentId || currentDeployment || uuidv4())
    : (existingDeploymentId || uuidv4());

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
    if (info.Certificate.Status === "ISSUED") { certReady = true; break; }
    await new Promise(r => setTimeout(r, 10_000));
  }
  if (!certReady) {
    return res.status(202).json({
      message: `Certificate request created for ${wildcard}. Re-run validation once DNS is ready.`,
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

  let parsedEnv = null;
  if (envVars !== undefined && envVars !== null) {
    try { parsedEnv = typeof envVars === "string" ? JSON.parse(envVars) : envVars; } catch { parsedEnv = null; }
  }
  let finalEnvVars = Array.isArray(parsedEnv) ? parsedEnv : fallbackEnvVars;

  const cfg = {
    repository      : repository      || parentCfg.repository      || null,
    branch          : branch          || parentCfg.branch          || "main",
    rootDirectory   : rootDirectory   || parentCfg.root_directory  || ".",
    outputDirectory : outputDirectory || parentCfg.output_directory|| "",
    buildCommand    : buildCommand    || parentCfg.build_command   || "",
    installCommand  : installCommand  || parentCfg.install_command || "npm install",
    envVars         : finalEnvVars
  };
  if (!Array.isArray(cfg.envVars)) cfg.envVars = [];

  let commitSha = null;
  if (cfg.repository && cfg.branch) {
    try {
      const tokenRow = await pool.query(
        "SELECT github_access_token FROM users WHERE username=$1",
        [userID]
      );
      const githubAccessToken = tokenRow.rows[0]?.github_access_token;
      commitSha = await deployManager.getLatestCommitSha(
        cfg.repository, cfg.branch, githubAccessToken
      );
    } catch {}
  }

  async function upsertDns(host) {
    const isApex = host.split(".").length === 3;  
    if (isApex) {
      const lb = await elbv2.send(
        new DescribeLoadBalancersCommand({ Names: [process.env.LOAD_BALANCER_NAME] })
      );
      await r53.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
          ChangeBatch : {
            Changes: [
              {
                Action: "UPSERT",
                ResourceRecordSet: {
                  Name: host,
                  Type: "A",
                  AliasTarget: {
                    HostedZoneId : lb.LoadBalancers[0].CanonicalHostedZoneId,
                    DNSName : albDns,
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
          ChangeBatch : {
            Changes: [
              {
                Action: "UPSERT",
                ResourceRecordSet: {
                  Name: host,
                  Type: "CNAME",
                  TTL : 60,
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
    tgArn = tgArn ||
      (await deployManager.ensureTargetGroup(projectName, isParent ? null : subLabel));

    for (const L of [L_HTTP, L_HTTPS]) {
      const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: L }));
      const missing = !Rules.some(r =>
        r.Conditions.some(c =>
          c.Field === "host-header" &&
          c.Values.map(v => v.toLowerCase()).includes(fqdn.toLowerCase())
        )
      );
      if (missing) {
        const used = new Set(Rules.filter(r => !r.IsDefault).map(r => Number(r.Priority)));
        let pr = 1; while (used.has(pr)) pr++;
        await elbv2.send(
          new CreateRuleCommand({
            ListenerArn: L,
            Priority   : pr,
            Conditions : [{ Field: "host-header", Values: [fqdn] }],
            Actions    : [{ Type: "forward", TargetGroupArn: tgArn }]
          })
        );
      }
    }
  }

  if (!parentCfg.task_def_arn && currentDeployment) {
    try {
      const tdRow = await pool.query(
        "SELECT task_def_arn FROM deployments WHERE deployment_id = $1",
        [currentDeployment]
      );
      parentCfg.task_def_arn = tdRow.rows[0]?.task_def_arn || null;
    } catch {}
  }

  if (!existingRedirect && parentCfg.task_def_arn) {     
    await deployManager.createOrUpdateService({
      projectName,
      subdomain : isParent ? null : subLabel,
      taskDefArn: parentCfg.task_def_arn,
      targetGroupArn: tgArn
    });
  } else if (!parentCfg.task_def_arn) {}

  const deploymentCheck = await pool.query(
    `SELECT domain_id
       FROM domains
      WHERE deployment_id = $1
        AND domain_id    != $2
        AND orgid         = $3`,
    [deploymentId, domainId, organizationID]
  );
  if (deploymentCheck.rows.length > 0 && !isParent) deploymentId = uuidv4();

  const existingDeployment = await pool.query(
    `SELECT deployment_id
       FROM deployments
      WHERE deployment_id = $1
        AND orgid         = $2`,
    [deploymentId, organizationID]
  );

  if (existingDeployment.rows.length === 0) {
    await pool.query(
      `INSERT INTO deployments
         (orgid, username, deployment_id, project_id, domain_id,
          status, url, template,
          created_at, updated_at, last_deployed_at,
          task_def_arn, commit_sha,
          root_directory, output_directory, build_command, install_command, env_vars)
       VALUES
         ($1,$2,$3,$4,$5,
          $6,$7,$8,
          $9,$10,$11,
          $12,$13,
          $14,$15,$16,$17,$18)`,
      [
        organizationID, userID, deploymentId, projectID, domainId,
        "active", `https://${fqdn}`, "default",
        timestamp, timestamp, timestamp,
        parentCfg.task_def_arn || null, commitSha,
        cfg.rootDirectory, cfg.outputDirectory,
        cfg.buildCommand,  cfg.installCommand,
        JSON.stringify(cfg.envVars)
      ]
    );

    await pool.query(
      `INSERT INTO deployment_logs
         (orgid, username, project_id, project_name,
          action, deployment_id, timestamp, ip_address)
       VALUES
         ($1,$2,$3,$4,
          $5,$6,$7,$8)`,
      [
        organizationID, userID, projectID, projectName,
        "validate-domain", deploymentId, timestamp, "127.0.0.1"
      ]
    );
  } else {
    await pool.query(
      `UPDATE deployments
          SET updated_at      = $1,
              last_deployed_at= $1,
              status          = $2,
              url             = $3,
              task_def_arn    = $4,
              commit_sha      = $5,
              root_directory  = $6,
              output_directory= $7,
              build_command   = $8,
              install_command = $9,
              env_vars        = $10,
              domain_id       = $11
        WHERE deployment_id   = $12
          AND orgid           = $13`,
      [
        timestamp, "active", `https://${fqdn}`,
        parentCfg.task_def_arn || null, commitSha,
        cfg.rootDirectory, cfg.outputDirectory,
        cfg.buildCommand,  cfg.installCommand,
        JSON.stringify(cfg.envVars),
        domainId, deploymentId, organizationID
      ]
    );
  }

  if (isParent && currentDeployment !== deploymentId) {
    await pool.query(
      `UPDATE projects
          SET current_deployment = $1,
              updated_at         = $2
        WHERE project_id        = $3
          AND orgid             = $4`,
      [deploymentId, timestamp, projectID, organizationID]
    );
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
      `UPDATE domains
          SET updated_at        = $1,
              deployment_id     = $2,
              certificate_arn   = $3,
              repository        = $4,
              branch            = $5,
              root_directory    = $6,
              output_directory  = $7,
              build_command     = $8,
              install_command   = $9,
              env_vars          = $10,
              target_group_arn  = $11
        WHERE domain_id         = $12`,
      [...valsCommon, domainId]
    );
  } else {
    await pool.query(
      `INSERT INTO domains
         (orgid, username, domain_id, domain_name,
          project_id, created_by, created_at, updated_at,
          environment, is_primary,
          deployment_id, certificate_arn,
          repository, branch, root_directory, output_directory,
          build_command, install_command, env_vars, target_group_arn)
       VALUES
         ($1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,
          $11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20)`,
      [
        organizationID, userID, domainId, storedName,
        projectID, userID, timestamp, timestamp,
        "production", isParent,
        deploymentId, certArn,
        cfg.repository, cfg.branch, cfg.rootDirectory, cfg.outputDirectory,
        cfg.buildCommand, cfg.installCommand,
        JSON.stringify(cfg.envVars),
        tgArn
      ]
    );
  }

  const recs = [];
  try { const a = await dns.resolve4(fqdn);  if (a.length) recs.push({ type: "A",     name: "@", value: a[0] }); } catch {}
  try { const a = await dns.resolve6(fqdn);  if (a.length) recs.push({ type: "AAAA",  name: "@", value: a[0] }); } catch {}
  try { const c = await dns.resolveCname(fqdn); if (c.length) recs.push({ type: "CNAME", name: "@", value: c[0] }); } catch {}
  try { const m = await dns.resolveMx(fqdn); if (m.length) recs.push({ type: "MX",    name: "@", value: m.map(r => `${r.priority} ${r.exchange}`).join(", ") }); } catch {}
  await pool.query(
    "UPDATE domains SET dns_records = $1 WHERE domain_id = $2",
    [JSON.stringify(recs), domainId]
  );

  if (!existingRedirect)
    await deployManager.recordRuntimeLogs(
      organizationID, userID, deploymentId, projectName,
      isParent ? null : subLabel
    );

  return res.status(200).json({
    message: existingRedirect
      ? `Subdomain ${subLabel} refreshed (redirect still → ${existingRedirect}).`
      : `Subdomain ${subLabel} validated${existing ? "" : " and deployment initiated"}.`,
    url           : `https://${fqdn}`,
    certificateArn: certArn,
    dnsRecords    : recs,
    deploymentId
  });
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

  async function validateTargetGroupHealth(tgArn) {
    try {
      const { TargetHealthDescriptions } = await elbv2.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: tgArn })
      );
      return TargetHealthDescriptions.some(t => t.TargetHealth.State === 'healthy');
    } catch (error) {
      throw new Error(`Failed to validate target group health: ${error.message}`);
    }
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
        targetFqdn = `${projectName}.stackforgeengine.com`;
      } else if (!t.includes(".")) {
        targetFqdn = `${t}.${projectName}.stackforgeengine.com`;
      } else {
        targetFqdn = `${t}.stackforgeengine.com`;
      }
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

      const isTgHealthy = await validateTargetGroupHealth(tgArn);

      if (parentTaskDef) {
        try {
          await deployManager.createOrUpdateService({
            projectName,
            subdomain: isApex ? null : sourceSub.split(".")[0],
            taskDefArn: parentTaskDef,
            targetGroupArn: tgArn
          });

          let healthCheckRetries = 5;
          let isTgHealthyPostDeploy = false;
          while (healthCheckRetries > 0) {
            isTgHealthyPostDeploy = await validateTargetGroupHealth(tgArn);
            if (isTgHealthyPostDeploy) break;
            await new Promise(resolve => setTimeout(resolve, 10000));
            healthCheckRetries--;
          }
          if (!isTgHealthyPostDeploy) {
            throw new Error(`Target group ${tgArn} has no healthy targets after service deployment`);
          }
        } catch (error) {
          return res.status(500).json({
            message: `Failed to deploy ECS service: ${error.message}.`
          });
        }
      } else {
        return res.status(400).json({
          message: "No parent task definition found; cannot restore service."
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
        let invalidationSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await cloudfront.send(new CreateInvalidationCommand({
              DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
              InvalidationBatch: {
                CallerReference: `redirect-remove-${domainID}-${Date.now()}`,
                Paths: { Quantity: 2, Items: ["/", "/*"] }
              }
            }));
            invalidationSuccess = true;
            break;
          } catch (error) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
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
      let invalidationSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await cloudfront.send(new CreateInvalidationCommand({
            DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
            InvalidationBatch: {
              CallerReference: `redirect-${domainID}-${Date.now()}`,
              Paths: { Quantity: 2, Items: ["/", "/*"] }
            }
          }));
          invalidationSuccess = true;
          break;
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
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