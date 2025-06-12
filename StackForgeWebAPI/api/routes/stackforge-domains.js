

const express = require("express");
const router = express.Router();
const dns = require("dns").promises;
const https = require("https");
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
  DeleteTargetGroupCommand
} = require("@aws-sdk/client-elastic-load-balancing-v2");
const { Route53Client, ChangeResourceRecordSetsCommand } = require("@aws-sdk/client-route-53");
const { ACMClient, RequestCertificateCommand, DescribeCertificateCommand, DeleteCertificateCommand } = require("@aws-sdk/client-acm");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");

const deployManager = require("./drivers/deployManager");

require("dotenv").config();
secretKey = process.env.JWT_SECRET_KEY;

router.post("/validate-domain", authenticateToken, async (req, res, next) => {
  const {
    userID,
    organizationID,
    projectID,
    domain,
    repository,
    branch,
    rootDirectory,
    outputDirectory,
    buildCommand,
    runCommand,
    installCommand,
    envVars,
    internalCall = false
  } = req.body

  if (!userID || !organizationID || !projectID || !domain) {
    return res.status(400).json({ message: "userID, organizationID, projectID, and domain are required." })
  }

  const waitDnsHttps = async host => {
    for (let i = 0; i < 12; i++) {
      try {
        await axios.get(`https://${host}`, { timeout: 5000 })
        return true
      } catch {}
      await new Promise(r => setTimeout(r, 10000))
    }
    return false
  }

  const timestamp = new Date().toISOString()
  const elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION })
  const r53 = new Route53Client({ region: process.env.AWS_REGION })
  const acm = new ACMClient({ region: process.env.AWS_REGION })

  const L_HTTPS = process.env.ALB_LISTENER_ARN_HTTPS
  const L_HTTP = process.env.ALB_LISTENER_ARN_HTTP
  const albDns = process.env.LOAD_BALANCER_DNS.endsWith(".") ? process.env.LOAD_BALANCER_DNS : `${process.env.LOAD_BALANCER_DNS}.`

  const projResult = await pool.query(
    `
      SELECT name, current_deployment, created_at
      FROM projects
      WHERE project_id=$1 AND orgid=$2 AND username=$3
    `,
    [projectID, organizationID, userID]
  )
  if (!projResult.rows.length) return res.status(404).json({ message: "Project not found." })

  const projectName = projResult.rows[0].name.toLowerCase()
  const currentDeployment = projResult.rows[0].current_deployment

  const parentResult = await pool.query(
    `
      SELECT dep.env_vars,
            d.repository, d.branch, d.root_directory, d.output_directory,
            d.build_command, d.run_command, d.install_command,
            dep.task_def_arn
      FROM domains d
            JOIN deployments dep ON dep.deployment_id = d.deployment_id
      WHERE d.project_id=$1 AND d.is_primary=true
    `,
    [projectID]
  )

  let parentCfg = parentResult.rows[0] || {}
  let parentRawEnv = parentCfg.env_vars
  if (parentRawEnv === undefined || parentRawEnv === null) {
    const fallback = await pool.query(
      `
        SELECT dep.env_vars
        FROM deployments dep
        JOIN domains d ON dep.deployment_id = d.deployment_id
        WHERE d.project_id=$1 AND d.is_primary=true
      `,
      [projectID]
    )
    parentRawEnv = fallback.rows[0]?.env_vars || []
  }

  let fallbackEnvVars
  try { fallbackEnvVars = Array.isArray(parentRawEnv) ? parentRawEnv : JSON.parse(parentRawEnv) }
  catch { fallbackEnvVars = [] }

  let raw = domain.trim().toLowerCase().replace(/\.stackforgeengine\.com$/i, "").replace(new RegExp(`\\.${projectName}$`), "")
  const isParent = raw === projectName || raw === ""
  const subLabel = isParent ? projectName : raw.split(".")[0]
  const stored = isParent ? projectName : `${subLabel}.${projectName}`
  const fqdn = `${stored}.stackforgeengine.com`

  const domResult = await pool.query(
    `
      SELECT domain_id, certificate_arn, target_group_arn, redirect_target, deployment_id
      FROM domains
      WHERE project_id=$1 AND domain_name=$2
    `,
    [projectID, stored]
  )
  const existing = domResult.rows[0] || null
  const domainID = existing?.domain_id || uuidv4()
  let certArn = existing?.certificate_arn || null
  let tgArn = existing?.target_group_arn || null
  const existingRedirect = existing?.redirect_target || null
  const existingDeployID = existing?.deployment_id || null

  const projectAgeMs = Date.now() - new Date(`${projResult.rows[0].created_at}Z`).getTime()
  if (!existing && !isParent && projectAgeMs < 300000) {
    const waitSec = Math.ceil((300000 - projectAgeMs) / 1000)
    return res.status(429).json({
      code: "DOMAIN_THROTTLED",
      message: `New domains may be added five minutes after project creation – wait ${waitSec}s.`
    })
  }

  let deploymentID = isParent ? (existingDeployID || currentDeployment || uuidv4()) : (existingDeployID || uuidv4())
  let parentTaskDef = parentCfg.task_def_arn
  if (!parentTaskDef && currentDeployment) {
    try {
      const td = await pool.query(
        "SELECT task_def_arn FROM deployments WHERE deployment_id=$1",
        [currentDeployment]
      )
      parentTaskDef = td.rows[0]?.task_def_arn || null
      parentCfg.task_def_arn = parentTaskDef
    } catch {}
  }

  const commonVals = [
    organizationID, userID, domainID, stored, projectID, userID,
    timestamp, timestamp, "production", isParent,
    deploymentID, certArn,
    parentCfg.repository || null, parentCfg.branch || null,
    parentCfg.root_directory || null, parentCfg.output_directory || null,
    parentCfg.build_command || null, parentCfg.run_command || null,
    parentCfg.install_command || null,
    JSON.stringify(fallbackEnvVars),
    tgArn
  ]

  if (existing) {
    await pool.query(
      `
        UPDATE domains
        SET updated_at=$1, deployment_id=$2, certificate_arn=$3, repository=$4, branch=$5,
            root_directory=$6, output_directory=$7, build_command=$8, run_command=$9,
            install_command=$10, env_vars=$11, target_group_arn=$12
        WHERE domain_id=$13
      `,
      [
        timestamp, deploymentID, certArn,
        parentCfg.repository || null, parentCfg.branch || null,
        parentCfg.root_directory || null, parentCfg.output_directory || null,
        parentCfg.build_command || null, parentCfg.run_command || null,
        parentCfg.install_command || null,
        JSON.stringify(fallbackEnvVars), tgArn, domainID
      ]
    )
  } else {
    await pool.query(
      `
        INSERT INTO domains (
          orgid, username, domain_id, domain_name,
          project_id, created_by, created_at, updated_at,
          environment, is_primary,
          deployment_id, certificate_arn,
          repository, branch, root_directory, output_directory,
          build_command, run_command, install_command, env_vars, target_group_arn
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,
          $11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20,$21
        )
      `,
      commonVals
    )
  }

  if (isParent && currentDeployment !== deploymentID) {
    await pool.query(
      `UPDATE projects SET current_deployment=$1, updated_at=$2 WHERE project_id=$3 AND orgid=$4`,
      [deploymentID, timestamp, projectID, organizationID]
    )
  }

  const wildcard = `*.${projectName}.stackforgeengine.com`
  const altNames = [wildcard, `${projectName}.stackforgeengine.com`]

  async function requestOrReuseCert() {
    const listResp = await acm.send(new ListCertificatesCommand({
      CertificateStatuses: ["ISSUED", "PENDING_VALIDATION"]
    }))
    const wanted = wildcard.toLowerCase()
    const found = listResp.CertificateSummaryList.find(
      c => c.DomainName.toLowerCase() === wanted
    )
    if (found) return found.CertificateArn
    const { CertificateArn } = await acm.send(new RequestCertificateCommand({
      DomainName: wildcard,
      SubjectAlternativeNames: altNames,
      ValidationMethod: "DNS"
    }))
    return CertificateArn
  }

  certArn = await requestOrReuseCert()

  const certInfo = await acm.send(new DescribeCertificateCommand({ CertificateArn: certArn }))
  const rr = certInfo.Certificate.DomainValidationOptions?.[0]?.ResourceRecord
  if (rr) {
    const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID.replace(/^\/hostedzone\//, "")
    await r53.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [{
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: rr.Name,
            Type: rr.Type,
            TTL: 300,
            ResourceRecords: [{ Value: rr.Value }]
          }
        }]
      }
    }))
  }

  let issued = false
  for (let i = 0; i < 30; i++) {
    const s = (await acm.send(new DescribeCertificateCommand({ CertificateArn: certArn }))).Certificate.Status
    if (s === "ISSUED") { issued = true; break }
    await new Promise(r => setTimeout(r, 10000))
  }
  if (!issued) {
    return res.status(202).json({
      message: `Certificate request created for ${wildcard}. Re-run validation once DNS propagated.`,
      certificateArn: certArn
    })
  }

  async function attachCert() {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { Certificates } = await elbv2.send(new DescribeListenerCertificatesCommand({ ListenerArn: L_HTTPS }))
      if (Certificates.some(c => c.CertificateArn === certArn)) return
      if (Certificates.length >= 25) {
        const removable = Certificates.filter(c => !c.IsDefault && c.CertificateArn !== certArn)
        for (const v of removable) {
          await elbv2.send(new RemoveListenerCertificatesCommand({
            ListenerArn: L_HTTPS,
            Certificates: [{ CertificateArn: v.CertificateArn }]
          }))
        }
      }
      try {
        await elbv2.send(new AddListenerCertificatesCommand({
          ListenerArn: L_HTTPS,
          Certificates: [{ CertificateArn: certArn }]
        }))
        return
      } catch {
        await new Promise(r => setTimeout(r, attempt * 3000))
      }
    }
    throw new Error("Failed to attach ACM certificate to listener.")
  }
  await attachCert()
  await pool.query("UPDATE domains SET certificate_arn=$1 WHERE domain_id=$2", [certArn, domainID])

  async function upsertDns(host) {
    const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID.replace(/^\/hostedzone\//, "")
    const isApex = host.split(".").length === 3
    const changes = []
    if (isApex) {
      const lb = await elbv2.send(new DescribeLoadBalancersCommand({ Names: [process.env.LOAD_BALANCER_NAME] }))
      const hzId = lb.LoadBalancers[0].CanonicalHostedZoneId
      changes.push({
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: host, Type: "A",
          AliasTarget: { HostedZoneId: hzId, DNSName: albDns, EvaluateTargetHealth: false }
        }
      })
      changes.push({
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: host, Type: "AAAA",
          AliasTarget: { HostedZoneId: hzId, DNSName: albDns, EvaluateTargetHealth: false }
        }
      })
    } else {
      changes.push({
        Action: "UPSERT",
        ResourceRecordSet: { Name: host, Type: "CNAME", TTL: 60, ResourceRecords: [{ Value: albDns }] }
      })
    }
    await r53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: hostedZoneId, ChangeBatch: { Changes: changes } }))
  }
  await upsertDns(fqdn)

  if (!existingRedirect) {
    tgArn = tgArn || await deployManager.ensureTargetGroup(projectName, isParent ? null : subLabel)

    for (const listener of [L_HTTP, L_HTTPS]) {
      const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listener }))
      const exists = Rules.some(r =>
        !r.IsDefault &&
        r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn))
      )
      if (!exists) {
        const used = new Set(Rules.filter(r => !r.IsDefault).map(r => parseInt(r.Priority, 10)))
        let pr = 1; while (used.has(pr)) pr++
        await elbv2.send(new CreateRuleCommand({
          ListenerArn: listener,
          Priority: pr,
          Conditions: [{ Field: "host-header", Values: [fqdn] }],
          Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
        }))
      }
    }
  }

  if (!existingRedirect && parentTaskDef) {
    await deployManager.createOrUpdateService({
      projectName,
      subdomain: isParent ? null : subLabel,
      taskDefArn: parentTaskDef,
      targetGroupArn: tgArn
    })
  }

  const cfg = {
    repository: repository || parentCfg.repository || null,
    branch: branch || parentCfg.branch || "main",
    rootDirectory: rootDirectory || parentCfg.root_directory || ".",
    outputDirectory: outputDirectory || parentCfg.output_directory || "",
    buildCommand: buildCommand || parentCfg.build_command || "",
    runCommand: runCommand || parentCfg.run_command || "",
    installCommand: installCommand || parentCfg.install_command || "npm install",
    envVars: Array.isArray(envVars) ? envVars : fallbackEnvVars
  }

  let commitSha = null
  if (cfg.repository && cfg.branch) {
    try {
      const tokenRow = await pool.query("SELECT github_access_token FROM users WHERE username=$1", [userID])
      const token = tokenRow.rows[0]?.github_access_token
      commitSha = await deployManager.getLatestCommitSha(cfg.repository, cfg.branch, token)
    } catch {}
  }

  const duplicate = await pool.query(
    `SELECT domain_id FROM domains WHERE deployment_id=$1 AND domain_id!=$2 AND orgid=$3`,
    [deploymentID, domainID, organizationID]
  )
  if (duplicate.rows.length && !isParent) deploymentID = uuidv4()

  const depExists = await pool.query(
    `SELECT deployment_id FROM deployments WHERE deployment_id=$1 AND orgid=$2`,
    [deploymentID, organizationID]
  )

  if (!depExists.rows.length) {
    await pool.query(
      `
        INSERT INTO deployments (
          orgid, username, deployment_id, project_id, domain_id,
          status, url, template,
          created_at, updated_at, last_deployed_at,
          task_def_arn, commit_sha,
          root_directory, output_directory, build_command, run_command, install_command, env_vars
        ) VALUES (
          $1,$2,$3,$4,$5,
          'active',$6,'default',
          $7,$7,$7,
          $8,$9,
          $10,$11,$12,$13,$14,$15
        )
      `,
      [
        organizationID, userID, deploymentID, projectID, domainID,
        `https://${fqdn}`, timestamp,
        parentTaskDef || null, commitSha,
        cfg.rootDirectory, cfg.outputDirectory, cfg.buildCommand, cfg.runCommand, cfg.installCommand,
        JSON.stringify(cfg.envVars)
      ]
    )
    await pool.query(
      `
        INSERT INTO deployment_logs (orgid,username,project_id,project_name,action,deployment_id,timestamp,ip_address)
        VALUES ($1,$2,$3,$4,'validate-domain',$5,$6,'127.0.0.1')
      `,
      [organizationID, userID, projectID, projectName, deploymentID, timestamp]
    )
  } else {
    await pool.query(
      `
        UPDATE deployments
        SET updated_at=$1,
          last_deployed_at=$1,
          status='active',
          url=$2,
          task_def_arn=$3,
          commit_sha=$4,
          root_directory=$5,
          output_directory=$6,
          build_command=$7,
          run_command=$8,
          install_command=$9,
          env_vars=$10,
          domain_id=$11
        WHERE deployment_id=$12 AND orgid=$13
      `,
      [
        timestamp, `https://${fqdn}`,
        parentTaskDef || null, commitSha,
        cfg.rootDirectory, cfg.outputDirectory,
        cfg.buildCommand, cfg.runCommand, cfg.installCommand,
        JSON.stringify(cfg.envVars),
        domainID, deploymentID, organizationID
      ]
    )
  }

  const recs = []
  try { const a = await dns.resolve4(fqdn); if (a.length) recs.push({ type: "A", name: "@", value: a[0] }) } catch {}
  try { const a = await dns.resolve6(fqdn); if (a.length) recs.push({ type: "AAAA", name: "@", value: a[0] }) } catch {}
  try { const c = await dns.resolveCname(fqdn); if (c.length) recs.push({ type: "CNAME", name: "@", value: c[0] }) } catch {}
  try { const m = await dns.resolveMx(fqdn); if (m.length) recs.push({ type: "MX", name: "@", value: m.map(r => `${r.priority} ${r.exchange}`).join(", ") }) } catch {}
  await pool.query("UPDATE domains SET dns_records=$1 WHERE domain_id=$2", [JSON.stringify(recs), domainID])

  if (!existingRedirect) {
    await deployManager.recordRuntimeLogs(
      organizationID,
      userID,
      deploymentID,
      projectName,
      isParent ? null : subLabel
    )
  }

  const ready = await waitDnsHttps(fqdn)

  if (!ready) {
    return res.status(202).json({
      message: `Subdomain ${subLabel} created; DNS/SSL still propagating.`,
      url: `https://${fqdn}`,
      certificateArn: certArn,
      dnsRecords: recs,
      deploymentID
    })
  }

  return res.status(200).json({
    message: existingRedirect ? `Subdomain ${subLabel} refreshed (redirect still → ${existingRedirect}).` : `Subdomain ${subLabel} validated${existing ? "" : " and deployment initiated"}.`,
    url: `https://${fqdn}`,
    certificateArn: certArn,
    dnsRecords: recs,
    deploymentID
  })
})

router.post("/delete-domain", authenticateToken, async (req, res, next) => {
  const { userID, organizationID, projectID, domainID } = req.body;

  if (!userID || !organizationID || !projectID || !domainID) {
    return res.status(400).json({
      message: "userID, organizationID, projectID, and domainID are required.",
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const domainResult = await client.query(
      `
        SELECT domain_name, certificate_arn, target_group_arn, deployment_id
        FROM domains
        WHERE domain_id = $1
          AND project_id = $2
          AND orgid = $3
          AND username = $4
      `,
      [domainID, projectID, organizationID, userID]
    );
    if (domainResult.rows.length === 0) {
      throw new Error("Domain not found or access denied.");
    }
    const {
      domain_name,
      certificate_arn: certArn,
      target_group_arn: tgArn,
      deployment_id: deploymentID,
    } = domainResult.rows[0];
    const fqdn = `${domain_name}.stackforgeengine.com`;

    if (!process.env.ROUTE53_HOSTED_ZONE_ID) {
      throw new Error("ROUTE53_HOSTED_ZONE_ID is not defined in environment variables.");
    }
    if (!process.env.LOAD_BALANCER_DNS) {
      throw new Error("LOAD_BALANCER_DNS is not defined in environment variables.");
    }
    if (!process.env.LOAD_BALANCER_NAME) {
      throw new Error("LOAD_BALANCER_NAME is not defined in environment variables.");
    }
    if (!process.env.AWS_REGION) {
      throw new Error("AWS_REGION is not defined in environment variables.");
    }

    const acmClient = new ACMClient({ region: process.env.AWS_REGION });
    const route53Client = new Route53Client({ region: process.env.AWS_REGION });
    const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
    const L_HTTP = process.env.ALB_LISTENER_ARN_HTTP;
    const L_HTTPS = process.env.ALB_LISTENER_ARN_HTTPS;
    const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID.replace(/^\/hostedzone\//, "");

    if (certArn) {
      const listenersResp = await elbv2Client.send(
        new DescribeListenersCommand({
          LoadBalancerArn: process.env.LOAD_BALANCER_ARN,
        })
      );
      for (const listener of listenersResp.Listeners || []) {
        const certsResp = await elbv2Client.send(
          new DescribeListenerCertificatesCommand({
            ListenerArn: listener.ListenerArn,
          })
        );
        if (certsResp.Certificates?.some((c) => c.CertificateArn === certArn)) {
          await elbv2Client.send(
            new RemoveListenerCertificatesCommand({
              ListenerArn: listener.ListenerArn,
              Certificates: [{ CertificateArn: certArn }],
            })
          );
        }
      }
      try {
        await acmClient.send(
          new DeleteCertificateCommand({
            CertificateArn: certArn,
          })
        );
      } catch (acmError) { }
    }

    const loadBalancerResp = await elbv2Client.send(
      new DescribeLoadBalancersCommand({
        Names: [process.env.LOAD_BALANCER_NAME],
      })
    );
    if (!loadBalancerResp.LoadBalancers || loadBalancerResp.LoadBalancers.length === 0) {
      throw new Error(`Load balancer ${process.env.LOAD_BALANCER_NAME} not found.`);
    }
    const canonicalHostedZoneId = loadBalancerResp.LoadBalancers[0].CanonicalHostedZoneId;
    const deleteChanges = [
      {
        Action: "DELETE",
        ResourceRecordSet: {
          Name: fqdn,
          Type: "A",
          AliasTarget: {
            HostedZoneId: canonicalHostedZoneId,
            DNSName: process.env.LOAD_BALANCER_DNS.endsWith(".")
              ? process.env.LOAD_BALANCER_DNS
              : `${process.env.LOAD_BALANCER_DNS}.`,
            EvaluateTargetHealth: false,
          },
        },
      },
      {
        Action: "DELETE",
        ResourceRecordSet: {
          Name: fqdn,
          Type: "CNAME",
          TTL: 60,
          ResourceRecords: [
            {
              Value: process.env.LOAD_BALANCER_DNS.endsWith(".")
                ? process.env.LOAD_BALANCER_DNS
                : `${process.env.LOAD_BALANCER_DNS}.`,
            },
          ],
        },
      },
    ];

    try {
      await route53Client.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          ChangeBatch: { Changes: deleteChanges },
        })
      );
    } catch (route53Error) {
      if (!route53Error.message.includes("but it was not found")) {
        throw new Error(`Route 53 error: ${route53Error.message}`);
      }
    }

    if (typeof deployManager.deleteService === "function") {
      await deployManager.deleteService({
        projectName: domain_name.split(".")[1],
        subdomain: domain_name.includes(".") ? domain_name.split(".")[0] : null,
      });
    }

    if (tgArn) {
      for (const listenerArn of [L_HTTP, L_HTTPS]) {
        if (!listenerArn) continue;
        try {
          const { Rules } = await elbv2Client.send(
            new DescribeRulesCommand({ ListenerArn: listenerArn })
          );
          for (const rule of Rules || []) {
            if (
              !rule.IsDefault &&
              rule.Actions.some((a) => a.Type === "forward" && a.TargetGroupArn === tgArn)
            ) {
              await elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn }));
            }
          }
        } catch (ruleError) { }
      }
    }

    if (tgArn) {
      try {
        await elbv2Client.send(
          new DeleteTargetGroupCommand({
            TargetGroupArn: tgArn,
          })
        );
      } catch (tgError) { }
    }

    await client.query("DELETE FROM metrics_events WHERE domain = $1", [domain_name]);
    await client.query("DELETE FROM metrics_daily WHERE domain = $1", [domain_name]);
    await client.query("DELETE FROM metrics_edge_requests WHERE domain = $1", [domain_name]);
    if (deploymentID) {
      await client.query("DELETE FROM deployment_logs WHERE deployment_id = $1 AND orgid = $2", [
        deploymentID,
        organizationID,
      ]);
      await client.query("DELETE FROM build_logs WHERE deployment_id = $1 AND orgid = $2", [
        deploymentID,
        organizationID,
      ]);
      await client.query("DELETE FROM runtime_logs WHERE deployment_id = $1 AND orgid = $2", [
        deploymentID,
        organizationID,
      ]);
      await client.query("DELETE FROM deployments WHERE deployment_id = $1 AND orgid = $2", [
        deploymentID,
        organizationID,
      ]);
    }
    await client.query("DELETE FROM domains WHERE domain_id = $1", [domainID]);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Subdomain "${domain_name}" and its resources have been deleted.`,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    if (!res.headersSent) {
      res.status(500).json({ message: `Failed to delete subdomain: ${error.message}.` });
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

router.post("/edit-redirect", authenticateToken, async (req, res, next) => {
  const { userID, organizationID, projectID, domainID, redirectTarget } = req.body;
  if (!userID || !organizationID || !projectID || !domainID) {
    return res.status(400).json({ message: "userID, organizationID, projectID, and domainID are required." });
  }
  const elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
  const cloudfront = new CloudFrontClient({ region: process.env.AWS_REGION });
  const route53Client = new Route53Client({ region: process.env.AWS_REGION });
  const lbDns = process.env.LOAD_BALANCER_DNS.endsWith(".") ? process.env.LOAD_BALANCER_DNS : `${process.env.LOAD_BALANCER_DNS}.`;
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
    let hostedZoneID;
    if (process.env.LOAD_BALANCER_NAME) {
      const { LoadBalancers } = await elbv2.send(
        new DescribeLoadBalancersCommand({ Names: [process.env.LOAD_BALANCER_NAME] })
      );
      hostedZoneID = LoadBalancers[0].CanonicalHostedZoneId;
    } else {
      const { Listeners } = await elbv2.send(
        new DescribeListenersCommand({ ListenerArns: [httpsArn] })
      );
      const lbArn = Listeners[0].LoadBalancerArn;
      const { LoadBalancers } = await elbv2.send(
        new DescribeLoadBalancersCommand({ LoadBalancerArns: [lbArn] })
      );
      hostedZoneID = LoadBalancers[0].CanonicalHostedZoneId;
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
              HostedZoneId: hostedZoneID,
              DNSName: lbDns,
              EvaluateTargetHealth: false
            }
          }
        }]
      }
    }));
  }
  async function validateTargetGroupHealth(tgArn) {
    const { TargetHealthDescriptions } = await elbv2.send(
      new DescribeTargetHealthCommand({ TargetGroupArn: tgArn })
    );
    return TargetHealthDescriptions.some(t => t.TargetHealth.State === "healthy");
  }
  async function asyncCloudfrontInvalidation(distributionID, domainID, type) {
    if (!distributionID) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await cloudfront.send(new CreateInvalidationCommand({
          DistributionID: distributionID,
          InvalidationBatch: {
            CallerReference: `${type}-${domainID}-${Date.now()}`,
            Paths: { Quantity: 2, Items: ["/", "/*"] }
          }
        }));
        break;
      } catch { await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  }
  try {
    const [projResult, domRes, parentRes] = await Promise.all([
      pool.query(
        "SELECT name FROM projects WHERE project_id=$1 AND orgid=$2 AND username=$3",
        [projectID, organizationID, userID]
      ),
      pool.query(
        "SELECT domain_name,target_group_arn,certificate_arn FROM domains WHERE domain_id=$1 AND project_id=$2 AND orgid=$3",
        [domainID, projectID, organizationID]
      ),
      pool.query(
        `
          SELECT dep.task_def_arn FROM domains d
          JOIN deployments dep ON dep.deployment_id = d.deployment_id
           WHERE d.project_id=$1 AND d.is_primary=true LIMIT 1
        `,
        [projectID]
      )
    ]);
    if (!projResult.rows.length || !domRes.rows.length) return res.status(404).json({ message: "Project or domain not found." });
    const projectName = projResult.rows[0].name.toLowerCase();
    const sourceSub = domRes.rows[0].domain_name.toLowerCase();
    const sourceFqdn = `${sourceSub}.stackforgeengine.com`;
    let tgArn = domRes.rows[0].target_group_arn || null;
    const certArn = domRes.rows[0].certificate_arn || null;
    const parentTaskDef = parentRes.rows[0]?.task_def_arn || null;
    const isApex = sourceSub === projectName;
    await upsertRecord(sourceFqdn);
    let targetFqdn = null;
    if (redirectTarget !== null) {
      let t = redirectTarget.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (t.endsWith(".stackforgeengine.com")) t = t.replace(/\.stackforgeengine\.com$/i, "");
      if (t === projectName) {
        targetFqdn = `${projectName}.stackforgeengine.com`;
      } else if (!t.includes(".")) {
        targetFqdn = `${t}.${projectName}.stackforgeengine.com`;
      } else {
        targetFqdn = `${t}.stackforgeengine.com`;
      }
      await upsertRecord(targetFqdn);
    }
    const { Rules: httpRules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: httpArn }));
    const { Rules: httpsRules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: httpsArn }));
    const deletePromises = [];
    for (const r of [...httpRules, ...httpsRules]) {
      if (!r.IsDefault && r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(sourceFqdn))) {
        deletePromises.push(elbv2.send(new DeleteRuleCommand({ RuleArn: r.RuleArn })));
      }
    }
    await Promise.all(deletePromises);
    if (redirectTarget === null) {
      if (certArn) {
        const { Certificates: currentCerts } = await elbv2.send(
          new DescribeListenerCertificatesCommand({ ListenerArn: httpsArn })
        );
        if (!currentCerts.some(c => c.CertificateArn === certArn)) {
          if (currentCerts.length >= 25) {
            const remVictim = currentCerts.find(c => !c.IsDefault && c.CertificateArn !== certArn);
            if (remVictim) {
              await elbv2.send(new RemoveListenerCertificatesCommand({
                ListenerArn: httpsArn,
                Certificates: [{ CertificateArn: remVictim.CertificateArn }]
              }));
            }
          }
          await elbv2.send(new AddListenerCertificatesCommand({
            ListenerArn: httpsArn,
            Certificates: [{ CertificateArn: certArn }]
          }));
        }
      }
      if (!tgArn) {
        tgArn = await deployManager.ensureTargetGroup(projectName, isApex ? null : sourceSub.split(".")[0]);
        await pool.query("UPDATE domains SET target_group_arn=$1 WHERE domain_id=$2", [tgArn, domainID]);
      }
      let isTgHealthy = await validateTargetGroupHealth(tgArn);
      if (parentTaskDef && !isTgHealthy) {
        await deployManager.createOrUpdateService({
          projectName,
          subdomain: isApex ? null : sourceSub.split(".")[0],
          taskDefArn: parentTaskDef,
          targetGroupArn: tgArn
        });
        let healthCheckRetries = 3;
        while (healthCheckRetries > 0) {
          isTgHealthy = await validateTargetGroupHealth(tgArn);
          if (isTgHealthy) break;
          await new Promise(resolve => setTimeout(resolve, 5000));
          healthCheckRetries--;
        }
        if (!isTgHealthy) return res.status(500).json({ message: `Target group ${tgArn} has no healthy targets after service deployment.` });
      } else if (!parentTaskDef) {
        return res.status(400).json({ message: "No parent task definition found; cannot restore service." });
      }
      const [httpPrio, httpsPrio] = await Promise.all([getFreePriority(httpArn), getFreePriority(httpsArn)]);
      await Promise.all([
        elbv2.send(new CreateRuleCommand({
          ListenerArn: httpArn,
          Priority: httpPrio,
          Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
          Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
        })),
        elbv2.send(new CreateRuleCommand({
          ListenerArn: httpsArn,
          Priority: httpsPrio,
          Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
          Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
        }))
      ]);
      await pool.query("UPDATE domains SET redirect_target=NULL, updated_at=$1 WHERE domain_id=$2", [new Date().toISOString(), domainID]);
      if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
        asyncCloudfrontInvalidation(process.env.CLOUDFRONT_DISTRIBUTION_ID, domainID, "redirect-remove");
      }
      return res.json({ success: true, message: "Redirect removed & host restored." });
    }
    const [httpPrio, httpsPrio] = await Promise.all([getFreePriority(httpArn), getFreePriority(httpsArn)]);
    await Promise.all([
      elbv2.send(new CreateRuleCommand({
        ListenerArn: httpArn,
        Priority: httpPrio,
        Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
        Actions: [{
          Type: "redirect",
          RedirectConfig: { Protocol: "HTTPS", Port: "443", Host: targetFqdn, Path: "/", Query: "", StatusCode: "HTTP_302" }
        }]
      })),
      elbv2.send(new CreateRuleCommand({
        ListenerArn: httpsArn,
        Priority: httpsPrio,
        Conditions: [{ Field: "host-header", Values: [sourceFqdn] }],
        Actions: [{
          Type: "redirect",
          RedirectConfig: { Protocol: "HTTPS", Port: "443", Host: targetFqdn, Path: "/", Query: "", StatusCode: "HTTP_302" }
        }]
      }))
    ]);
    await pool.query("UPDATE domains SET redirect_target=$1, updated_at=$2 WHERE domain_id=$3", [targetFqdn.replace(/\.stackforgeengine\.com$/i, ""), new Date().toISOString(), domainID]);
    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      asyncCloudfrontInvalidation(process.env.CLOUDFRONT_DISTRIBUTION_ID, domainID, "redirect");
    }
    return res.json({ success: true, message: "Redirect updated." });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ message: `Failed to update redirect rules: ${error.message}.` });
    next(error);
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
      `
        INSERT INTO deployment_logs
          (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
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

module.exports = router;