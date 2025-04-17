require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();
const { pool } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const { Route53Client, ChangeResourceRecordSetsCommand } = require("@aws-sdk/client-route-53");
const route53Client = new Route53Client({ region: process.env.AWS_REGION });

class DeployManager {
  runCommand(cmd, cwd, env, logStream) {
    const parts = cmd.split(" ");
    const result = spawnSync(parts[0], parts.slice(1), { cwd, env, encoding: "utf-8" });
    if (result.stdout) logStream.write(result.stdout);
    if (result.stderr) logStream.write(result.stderr);
    if (result.status !== 0) throw new Error(`Command failed: ${cmd}`);
  }

  streamCommand(cmd, cwd, env, onData) {
    return new Promise((resolve, reject) => {
      const parts = cmd.split(" ");
      const child = spawn(parts[0], parts.slice(1), { cwd, env });
      child.stdout.on("data", d => onData(d.toString()));
      child.stderr.on("data", d => onData(d.toString()));
      child.on("error", err => reject(err));
      child.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed: ${cmd}`));
      });
    });
  }

  async cloneAndBuild({ repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName }) {
    const workspaceRoot = path.join(process.env.DEPLOY_WORKSPACE || "/tmp", `${projectName}-${uuidv4()}`);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const logPath = path.join(workspaceRoot, "build.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    let repoUrl = repository;
    if (!/^https?:\/\//i.test(repository) && !/^git@/i.test(repository)) {
      if (process.env.GITHUB_CLONE_TOKEN) {
        repoUrl = `https://${process.env.GITHUB_CLONE_TOKEN}@github.com/${repository}.git`;
      } else {
        repoUrl = `https://github.com/${repository}.git`;
      }
    }
    try {
      this.runCommand(`git clone --depth 1 -b ${branch} ${repoUrl} ${workspaceRoot}`, null, process.env, logStream);
      const projectRoot = path.join(workspaceRoot, rootDirectory || "");
      this.runCommand(installCommand || "npm install", projectRoot, { ...process.env, ...envVars }, logStream);
      this.runCommand(buildCommand || "npm run build", projectRoot, { ...process.env, ...envVars }, logStream);
      spawn("npx", ["serve", "-s", path.join(projectRoot, outputDirectory || "build"), "-l", "3000"], { detached: true, stdio: "ignore" }).unref();
      return logPath;
    } catch (err) {
      err.logPath = logPath;
      throw err;
    } finally {
      logStream.end();
    }
  }

  async cloneAndBuildStream({ repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName }, onData) {
    const workspaceRoot = path.join(process.env.DEPLOY_WORKSPACE || "/tmp", `${projectName}-${uuidv4()}`);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    let repoUrl = repository;
    if (!/^https?:\/\//i.test(repository) && !/^git@/i.test(repository)) {
      if (process.env.GITHUB_CLONE_TOKEN) {
        repoUrl = `https://${process.env.GITHUB_CLONE_TOKEN}@github.com/${repository}.git`;
      } else {
        repoUrl = `https://github.com/${repository}.git`;
      }
    }
    await this.streamCommand(`git clone --depth 1 -b ${branch} ${repoUrl} ${workspaceRoot}`, null, process.env, onData);
    const projectRoot = path.join(workspaceRoot, rootDirectory || "");
    await this.streamCommand(installCommand || "npm install", projectRoot, { ...process.env, ...envVars }, onData);
    await this.streamCommand(buildCommand || "npm run build", projectRoot, { ...process.env, ...envVars }, onData);
    spawn("npx", ["serve", "-s", path.join(projectRoot, outputDirectory || "build"), "-l", "3000"], { detached: true, stdio: "ignore" }).unref();
  }

  async launchWebsite({ userID, organizationID, projectName, domainName, template, repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars }) {
    const deploymentId = uuidv4();
    const timestamp = new Date().toISOString();
    const url = `https://${domainName}.stackforgeengine.com`;
    const projectID = uuidv4();
    await pool.query(
      `INSERT INTO projects 
      (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, current_deployment, image) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT DO NOTHING;`,
      [organizationID, userID, projectID, projectName, null, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), userID, timestamp, timestamp, url, repository, deploymentId, null]
    );
    const domainId = uuidv4();
    await pool.query(
      `INSERT INTO domains 
      (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING;`,
      [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
    );
    await pool.query(
      `INSERT INTO deployments 
      (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      [organizationID, userID, deploymentId, projectID, domainId, "building", url, template || "default", timestamp, timestamp, timestamp]
    );
    await pool.query(
      `INSERT INTO deployment_logs 
      (orgid, username, action, deployment_id, timestamp, ip_address) 
      VALUES ($1, $2, $3, $4, $5, $6);`,
      [organizationID, userID, "launch", deploymentId, timestamp, "127.0.0.1"]
    );
    await this.updateDNSRecord(domainName);
    let logPath = null;
    try {
      logPath = await this.cloneAndBuild({ repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName });
      await pool.query("UPDATE deployments SET status=$1, updated_at=$2 WHERE deployment_id=$3", ["active", new Date().toISOString(), deploymentId]);
      return { url, deploymentId, logPath };
    } catch (error) {
      await pool.query("UPDATE deployments SET status=$1, updated_at=$2 WHERE deployment_id=$3", ["failed", new Date().toISOString(), deploymentId]);
      await pool.query(
        `INSERT INTO deployment_logs 
        (orgid, username, action, deployment_id, timestamp, ip_address) 
        VALUES ($1, $2, $3, $4, $5, $6);`,
        [organizationID, userID, "build_failed", deploymentId, new Date().toISOString(), "127.0.0.1"]
      );
      error.logPath = error.logPath || logPath;
      throw error;
    }
  }

  async launchWebsiteStream(
    { userID, organizationID, projectName, domainName, template, repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars },
    onData
  ) {
    const deploymentId = uuidv4();
    const timestamp = new Date().toISOString();
    const url = `https://${domainName}.stackforgeengine.com`;
    const projectID = uuidv4();
    await pool.query(
      `INSERT INTO projects 
      (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, current_deployment, image) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT DO NOTHING;`,
      [organizationID, userID, projectID, projectName, null, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), userID, timestamp, timestamp, url, repository, deploymentId, null]
    );
    const domainId = uuidv4();
    await pool.query(
      `INSERT INTO domains 
      (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING;`,
      [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
    );
    await pool.query(
      `INSERT INTO deployments 
      (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      [organizationID, userID, deploymentId, projectID, domainId, "building", url, template || "default", timestamp, timestamp, timestamp]
    );
    await pool.query(
      `INSERT INTO deployment_logs 
      (orgid, username, action, deployment_id, timestamp, ip_address) 
      VALUES ($1, $2, $3, $4, $5, $6);`,
      [organizationID, userID, "launch", deploymentId, timestamp, "127.0.0.1"]
    );
    await this.updateDNSRecord(domainName);

    await this.cloneAndBuildStream(
      { repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName },
      onData
    );
  }

  async updateDNSRecord(subdomain) {
    const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
    const loadBalancerDNS = process.env.LOAD_BALANCER_DNS;
    if (!hostedZoneId || !loadBalancerDNS) throw new Error("Route53 DNS configuration missing.");
    const params = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: `${subdomain}.stackforgeengine.com`,
              Type: "CNAME",
              TTL: 300,
              ResourceRecords: [{ Value: loadBalancerDNS }]
            }
          }
        ]
      }
    };
    const cmd = new ChangeResourceRecordSetsCommand(params);
    await route53Client.send(cmd);
  }

  async getDeploymentStatus(deploymentId, organizationID, userID) {
    const result = await pool.query(
      `SELECT 
          d.*,
          p.name AS project_name,
          dm.domain_name AS domain,
          o.orgname 
        FROM deployments d
        LEFT JOIN projects p ON d.project_id = p.project_id
        LEFT JOIN domains dm ON d.domain_id = dm.domain_id
        JOIN organizations o ON d.orgid = o.orgid
        WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3;`,
      [deploymentId, organizationID, userID]
    );
    if (result.rows.length === 0) throw new Error("Deployment not found or access denied");
    return result.rows[0];
  }

  async listDeployments(organizationID) {
    const result = await pool.query(
      `SELECT 
          d.deployment_id,
          d.orgid,
          d.user
          ... (rest unchanged) ...
          ORDER BY d.created_at DESC;`,
      [organizationID]
    );
    return result.rows;
  }

  async listProjects(organizationID) {
    const result = await pool.query(
      `SELECT 
          *
        FROM projects
        WHERE orgid = $1
        ORDER BY created_at DESC;`,
      [organizationID]
    );
    return result.rows;
  }

  async listDomains(organizationID) {
    const result = await pool.query(
      `SELECT 
          domain_id,
          orgid,
          username,
          domain_name,
          project_id,
          created_by,
          created_at,
          updated_at
        FROM domains
        WHERE orgid = $1
        ORDER BY created_at DESC;`,
      [organizationID]
    );
    return result.rows;
  }
}

const deployManager = new DeployManager();

router.get("/deploy-project-stream", (req, res, next) => {
  if (req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authenticateToken(req, res, async () => {
    req.socket.setTimeout(0);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
      if (res.flush) res.flush();
    }, 15000);

    res.write(`: connected\n\n`);

    const {
      userID,
      organizationID,
      repository,
      branch,
      teamName,
      projectName,
      rootDirectory,
      outputDirectory,
      buildCommand,
      installCommand
    } = req.query;

    let envVars = [];
    try {
      envVars = JSON.parse(req.query.envVars || "[]");
    } catch {
      envVars = [];
    }

    const domainName = projectName.toLowerCase().replace(/\s+/g, "-");

    function send(line) {
      line.split(/\r?\n/).forEach(l => {
        if (l) {
          res.write(`data: ${l}\n\n`);
          if (res.flush) res.flush();
        }
      });
    }

    try {
      await deployManager.launchWebsiteStream(
        {
          userID,
          organizationID,
          projectName,
          domainName,
          template: "default",
          repository,
          branch,
          teamName,
          rootDirectory,
          outputDirectory,
          buildCommand,
          installCommand,
          envVars
        },
        send
      );
      clearInterval(heartbeat);
      res.write(`data: __BUILD_COMPLETE__\n\n`);
      res.end();
    } catch (err) {
      clearInterval(heartbeat);
      res.write(`data: __BUILD_ERROR__${err.message}\n\n`);
      res.end();
    }
  });
});

router.post("/status", authenticateToken, async (req, res, next) => {
  const { organizationID, userID, deploymentId } = req.body;
  try {
    const status = await deployManager.getDeploymentStatus(deploymentId, organizationID, userID);
    res.status(200).json(status);
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ message: error.message });
    next(error);
  }
});

router.post("/list-projects", authenticateToken, async (req, res, next) => {
  const organizationID = req.body.organizationID;
  try {
    const projects = await deployManager.listProjects(organizationID);
    res.status(200).json(projects);
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ message: error.message });
    next(error);
  }
});

router.post("/list-deployments", authenticateToken, async (req, res, next) => {
  const organizationID = req.body.organizationID;
  try {
    const deployments = await deployManager.listDeployments(organizationID);
    res.status(200).json(deployments);
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ message: error.message });
    next(error);
  }
});

router.post("/list-domains", authenticateToken, async (req, res, next) => {
  const organizationID = req.body.organizationID;
  try {
    const domains = await deployManager.listDomains(organizationID);
    res.status(200).json(domains);
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ message: error.message });
    next(error);
  }
});

router.post("/deploy-project", authenticateToken, async (req, res, next) => {
  const { userID, organizationID, repository, branch, teamName, projectName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars } = req.body;
  if (!repository || !branch || !projectName) return res.status(400).json({ message: "Missing required deployment information." });
  try {
    const existingProjectResult = await pool.query("SELECT * FROM projects WHERE orgid = $1 AND username = $2 AND name = $3", [organizationID, userID, projectName]);
    if (existingProjectResult.rows.length > 0) return res.status(400).json({ message: "A project with the same name already exists for this user and organization." });
    const domainName = projectName.toLowerCase().replace(/\s+/g, "-");
    try {
      const deploymentResult = await deployManager.launchWebsite({ userID, organizationID, projectName, domainName, template: "default", repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars });
      return res.status(200).json({ message: "Project deployed successfully.", url: deploymentResult.url, deploymentId: deploymentResult.deploymentId, buildLog: deploymentResult.logPath });
    } catch (err) {
      return res.status(500).json({ message: err.message, buildLog: err.logPath });
    }
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ message: error.message });
    next(error);
  }
});

router.post("/project-details", authenticateToken, async (req, res, next) => {
  const { organizationID, userID, projectID } = req.body;
  try {
    const projectResult = await pool.query(
      "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
      [projectID, organizationID, userID]
    );
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: "Project not found or access denied." });
    }
    const project = projectResult.rows[0];
    const domainsResult = await pool.query(
      "SELECT * FROM domains WHERE project_id = $1 AND orgid = $2",
      [projectID, organizationID]
    );
    const deploymentsResult = await pool.query(
      "SELECT * FROM deployments WHERE project_id = $1 AND orgid = $2",
      [projectID, organizationID]
    );
    return res.status(200).json({ project, domains: domainsResult.rows, deployments: deploymentsResult.rows });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
    }
    next(error);
  }
});

router.post("/snapshot", authenticateToken, async (req, res, next) => {
  const { projectID, organizationID, userID } = req.body;
  try {
    const projectResult = await pool.query(
      "SELECT url FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
      [projectID, organizationID, userID]
    );
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: "Project not found or access denied." });
    }
    const url = projectResult.rows[0].url;
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      const buffer = await page.screenshot();
      await browser.close();
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": buffer.length
      });
      return res.end(buffer);
    } catch (error) {
      await browser.close();
      const defaultImagePath = path.join(__dirname, "../public/StackForgeLogo.png");
      const buffer = fs.readFileSync(defaultImagePath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": buffer.length
      });
      return res.end(buffer);
    }
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
    }
    next(error);
  }
});

router.post("/git-commits", authenticateToken, async (req, res, next) => {
  const { userID, owner, repo } = req.body;
  try {
    if (!owner || !repo) {
      return res.status(400).json({ message: "Owner and repository are required." });
    }
    const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
    if (result.rows.length === 0 || !result.rows[0].github_access_token) {
      return res.status(400).json({ message: "GitHub account not connected." });
    }
    const githubAccessToken = result.rows[0].github_access_token;
    let repoName = repo;
    let repoOwner = owner;
    if (repo.includes("/")) {
      let parts = repo.split("/");
      repoOwner = parts[0];
      repoName = parts[1];
    }
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits`;
    const gitResponse = await axios.get(url, {
      headers: {
        Authorization: `token ${githubAccessToken}`,
        Accept: "application/vnd.github.v3+json"
      }
    });
    return res.status(200).json(gitResponse.data);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: "Error fetching git commits." });
    }
    next(error);
  }
});

router.post("/git-commit-details", authenticateToken, async (req, res, next) => {
  const { userID, owner, repo, commitSha } = req.body;
  try {
    if (!owner || !repo || !commitSha) {
      return res.status(400).json({ message: "Owner, repository, and commitSha are required." });
    }
    const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
    if (result.rows.length === 0 || !result.rows[0].github_access_token) {
      return res.status(400).json({ message: "GitHub account not connected." });
    }
    const githubAccessToken = result.rows[0].github_access_token;
    let repoName = repo;
    let repoOwner = owner;
    if (repo.includes("/")) {
      let parts = repo.split("/");
      repoOwner = parts[0];
      repoName = parts[1];
    }
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${commitSha}`;
    const gitResponse = await axios.get(url, {
      headers: {
        Authorization: `token ${githubAccessToken}`,
        Accept: "application/vnd.github.v3+json"
      }
    });
    return res.status(200).json(gitResponse.data);
  } catch (error) {
    if (!res.headersSent) {
      return res.status(400).json({ message: "Error fetching commit details." });
    }
    next(error);
  }
});

router.post("/git-analytics", authenticateToken, async (req, res, next) => {
  const { userID, websiteURL, repository, owner } = req.body;
  let websiteAnalytics = null;
  let repositoryAnalytics = null;
  try {
    if (websiteURL) {
      const startTime = Date.now();
      const websiteResponse = await axios.get(websiteURL, { timeout: 30000 });
      const responseTime = Date.now() - startTime;
      let contentLength = websiteResponse.headers["content-length"];
      if (!contentLength && websiteResponse.data) {
        contentLength = websiteResponse.data.toString().length;
      }
      websiteAnalytics = {
        status: websiteResponse.status,
        responseTime,
        contentLength: contentLength
      };
    }
    if (repository) {
      let repoName = repository;
      let repoOwner = owner;
      if (repository.includes("/")) {
        let parts = repository.split("/");
        repoOwner = parts[0];
        repoName = parts[1];
      }
      const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
      if (result.rows.length === 0 || !result.rows[0].github_access_token) {
        return res.status(400).json({ message: "GitHub account not connected." });
      }
      const githubAccessToken = result.rows[0].github_access_token;
      const repoResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
        headers: {
          Authorization: `token ${githubAccessToken}`,
          Accept: "application/vnd.github.v3+json"
        }
      });
      repositoryAnalytics = repoResponse.data;
    }
    return res.status(200).json({ websiteAnalytics, repositoryAnalytics });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: "Error fetching analytics.", error: error.message });
    }
    next(error);
  }
});

module.exports = router;
