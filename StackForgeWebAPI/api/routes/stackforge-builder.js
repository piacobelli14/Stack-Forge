require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const { pool } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");
const deployManager = require("./drivers/deployManager");

router.get("/deploy-project-stream", (req, res, next) => {
    if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;

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

        const sendLine = (chunk) => {
            let safe = chunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
            while (safe.length > 3500) {
                res.write(`data: ${safe.slice(0, 3500)}\n\n`);
                safe = safe.slice(3500);
            }
            res.write(`data: ${safe}\n\n`);
            if (res.flush) res.flush();
        };

        try {
            if (!projectName?.trim()) {
                sendLine("Error: projectName is required and cannot be empty\n");
                throw new Error("projectName is required and cannot be empty.");
            }
            if (!repository || !branch) {
                sendLine("Error: repository and branch are required\n");
                throw new Error("repository and branch are required.");
            }

            sendLine(`Received projectName: ${projectName}\n`);
            const domainName = projectName.toLowerCase().replace(/\s+/g, "-");
            sendLine(`Generated domainName: ${domainName}\n`);
            sendLine(
                `Starting deployment with parameters: userID=${userID}, orgID=${organizationID}, repo=${repository}, branch=${branch}\n`
            );
            sendLine(`Type of sendLine: ${typeof sendLine}\n`);

            await deployManager.launchWebsiteStream(
                {
                    userID,
                    organizationID,
                    projectName,
                    domainName,
                    domainNames: [domainName],      
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
                sendLine
            );

            sendLine("DEBUG: fetching new project_id from database\n");
            const projRes = await pool.query(
                "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
                [organizationID, userID, projectName]
            );
            const projectID = projRes.rows[0]?.project_id;
            sendLine(`DEBUG: project_id = ${projectID}\n`);
            sendLine("DEBUG: calling /validate-domain to populate dns_records\n");
            const validateRes = await axios.post(
                `${req.protocol}://${req.get("host")}/validate-domain`,
                { userID, organizationID, projectID, domain: projectName },
                { headers: { Authorization: req.headers.authorization } }
            );
            sendLine(`DEBUG: /validate-domain response → ${JSON.stringify(validateRes.data)}\n`);

            clearInterval(heartbeat);
            res.write(`data: __BUILD_COMPLETE__\n\n`);
            res.end();
        } catch (error) {
            clearInterval(heartbeat);
            sendLine(`__BUILD_ERROR__${error.message}\n`);
            res.end();
        }
    });
});

router.post("/deploy-project", authenticateToken, async (req, res, next) => {
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
        installCommand,
        envVars
    } = req.body;

    if (!repository || !branch || !projectName) {
        return res
            .status(400)
            .json({ message: "Missing required deployment information." });
    }

    try {
        const domainName = projectName.toLowerCase().replace(/\s+/g, "-");

        const deploymentResult = await deployManager.launchWebsite({
            userID,
            organizationID,
            projectName,
            domainName,
            domainNames: [domainName],      
            template: "default",
            repository,
            branch,
            teamName,
            rootDirectory,
            outputDirectory,
            buildCommand,
            installCommand,
            envVars
        });

        return res.status(200).json({
            message: "Project deployed successfully.",
            url: deploymentResult.url,
            deploymentId: deploymentResult.deploymentId,
            buildLog: deploymentResult.logPath
        });
    } catch (error) {
        const buildLog = error?.logPath || undefined;
        return res.status(500).json({ message: error.message, buildLog });
    }
});

router.post("/update-project", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectName, subdomains, repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars } = req.body;
    const timestamp = new Date().toISOString();

    if (!userID || !organizationID || !projectName || !subdomains || !Array.isArray(subdomains) || subdomains.length === 0) {
        return res.status(400).json({
            message: "userID, organizationID, projectName, and subdomains (non-empty array) are required."
        });
    }

    try {
        const projectResult = await pool.query(
            "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
            [organizationID, userID, projectName]
        );
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ message: "Project not found." });
        }
        const projectID = projectResult.rows[0].project_id;
        const domainResult = await pool.query(
            "SELECT domain_name, domain_id FROM domains WHERE project_id = $1 AND orgid = $2",
            [projectID, organizationID]
        );
        const validDomains = domainResult.rows.map(row => row.domain_name);
        const invalidSubdomains = subdomains.filter(sub => !validDomains.includes(sub));
        if (invalidSubdomains.length > 0) {
            return res.status(400).json({
                message: `Invalid subdomains: ${invalidSubdomains.join(", ")}. Must be one of: ${validDomains.join(", ")}.`
            });
        }

        const tokenResult = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            return res.status(400).json({ message: "GitHub account not connected." });
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;

        let commitSha;
        try {
            commitSha = await deployManager.getLatestCommitSha(repository, branch, githubAccessToken);
        } catch (error) {
            return res.status(500).json({ message: `Failed to fetch commit SHA: ${error.message}` });
        }

        const results = [];
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });

        for (const subdomain of subdomains) {
            const deploymentId = uuidv4();
            const isBaseDomain = subdomain === projectName;
            const url = `https://${subdomain}.stackforgeengine.com`;

            const domainDetailsResult = await pool.query(
                `SELECT repository, branch, root_directory, output_directory, install_command, build_command, env_vars, domain_id
                 FROM domains
                 WHERE domain_name = $1 AND project_id = $2`,
                [subdomain, projectID]
            );
            if (domainDetailsResult.rows.length === 0) {
                return res.status(404).json({ message: `Domain ${subdomain} not found for project ${projectName}.` });
            }
            const domainDetails = domainDetailsResult.rows[0];
            const domainId = domainDetails.domain_id;

            const config = {
                repository: repository || domainDetails.repository,
                branch: branch || domainDetails.branch || "main",
                rootDirectory: rootDirectory || domainDetails.root_directory || ".",
                outputDirectory: outputDirectory || domainDetails.output_directory || "",
                buildCommand: buildCommand || domainDetails.build_command || "",
                installCommand: installCommand || domainDetails.install_command || "npm install",
                envVars: envVars || (domainDetails.env_vars ? JSON.parse(domainDetails.env_vars) : [])
            }
            await deployManager.ensureECRRepo(projectName);
            await deployManager.createCodeBuildProject({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                repository: config.repository,
                branch: config.branch,
                rootDirectory: config.rootDirectory,
                installCommand: config.installCommand,
                buildCommand: config.buildCommand,
                outputDirectory: config.outputDirectory,
                githubAccessToken
            });

            const { imageUri, logFile } = await deployManager.startCodeBuild({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                repository: config.repository,
                branch: config.branch,
                logDir,
                githubAccessToken
            });

            const taskDefArn = await deployManager.createTaskDef({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                imageUri,
                envVars: config.envVars
            });

            const targetGroupArn = await deployManager.ensureTargetGroup(projectName, isBaseDomain ? null : subdomain);

            await deployManager.createOrUpdateService({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                taskDefArn,
                targetGroupArn
            });

            await pool.query(
                "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND domain_id = $4 AND status = $5",
                ["inactive", timestamp, projectID, domainId, "active"]
            );

            await pool.query(
                `INSERT INTO deployments 
                 (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                [
                    organizationID,
                    userID,
                    deploymentId,
                    projectID,
                    domainId,
                    "active",
                    url,
                    "default",
                    timestamp,
                    timestamp,
                    timestamp,
                    taskDefArn,
                    commitSha,
                    config.rootDirectory,
                    config.outputDirectory,
                    config.buildCommand,
                    config.installCommand,
                    JSON.stringify(config.envVars)
                ]
            );

            await pool.query(
                `UPDATE domains
                 SET repository = $1, branch = $2, root_directory = $3, output_directory = $4, build_command = $5, install_command = $6, env_vars = $7, deployment_id = $8, updated_at = $9
                 WHERE domain_name = $10 AND project_id = $11`,
                [
                    config.repository,
                    config.branch,
                    config.rootDirectory,
                    config.outputDirectory,
                    config.buildCommand,
                    config.installCommand,
                    JSON.stringify(config.envVars),
                    deploymentId,
                    timestamp,
                    subdomain,
                    projectID
                ]
            );

            await pool.query(
                `INSERT INTO deployment_logs 
                 (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    organizationID,
                    userID,
                    projectID,
                    projectName,
                    "update",
                    deploymentId,
                    timestamp,
                    "127.0.0.1"
                ]
            );

            await deployManager.updateDNSRecord(projectName, subdomains, targetGroupArn);
            await deployManager.recordBuildLogs(organizationID, userID, deploymentId, logDir);
            await deployManager.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);

            results.push({ subdomain, url, deploymentId, taskDefArn });
        }

        return res.status(200).json({
            message: `Successfully updated project ${projectName} for subdomains: ${subdomains.join(", ")}.`,
            results
        });
    } catch (error) {
        return res.status(500).json({ message: `Failed to update project: ${error.message}` });
    }
});

router.post("/update-project-stream", authenticateToken, async (req, res, next) => {
    const {
        userID,
        organizationID,
        projectName,
        subdomains,
        repository,
        branch,
        teamName,
        rootDirectory,
        outputDirectory,
        buildCommand,
        installCommand,
        envVars
    } = req.body;

    if (!userID || !organizationID || !projectName || !subdomains || !Array.isArray(subdomains) || subdomains.length === 0) {
        return res.status(400).json({
            message: "userID, organizationID, projectName, and subdomains (non-empty array) are required."
        });
    }

    const timestamp = new Date().toISOString();
    const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
    fs.mkdirSync(logDir, { recursive: true });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const writeChunk = (chunk) => {
        if (!res.writable) return;
        res.write(chunk);
        res.flush();
    };

    try {
        writeChunk(`Starting update for project: ${projectName}, subdomains: ${subdomains.join(", ")}\n`);
        writeChunk(`Verifying project exists: ${projectName}\n`);
        const projectResult = await pool.query(
            "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
            [organizationID, userID, projectName]
        );
        if (projectResult.rows.length === 0) {
            writeChunk(`Project ${projectName} not found\n`);
            res.status(404).end();
            return;
        }
        const projectID = projectResult.rows[0].project_id;

        writeChunk(`Validating subdomains: ${subdomains.join(", ")}\n`);
        const domainResult = await pool.query(
            "SELECT domain_name, domain_id FROM domains WHERE project_id = $1 AND orgid = $2",
            [projectID, organizationID]
        );
        const validDomains = domainResult.rows.map(row => row.domain_name);
        const invalidSubdomains = subdomains.filter(sub => !validDomains.includes(sub));
        if (invalidSubdomains.length > 0) {
            writeChunk(`Invalid subdomains: ${invalidSubdomains.join(", ")}\n`);
            res.status(400).end();
            return;
        }

        writeChunk(`Fetching GitHub access token for user: ${userID}\n`);
        const tokenResult = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            writeChunk(`No GitHub access token found\n`);
            res.status(400).end();
            return;
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;

        writeChunk(`Fetching commit SHA for repository: ${repository}, branch: ${branch}\n`);
        let commitSha;
        try {
            commitSha = await deployManager.getLatestCommitSha(repository, branch, githubAccessToken);
            writeChunk(`Fetched commit SHA: ${commitSha}\n`);
        } catch (error) {
            writeChunk(`Failed to fetch commit SHA: ${error.message}\n`);
            res.status(500).end();
            return;
        }

        const results = [];
        let streamBuffer = "";

        const capturingOnData = (chunk) => {
            streamBuffer += chunk;
            writeChunk(chunk);
        };

        for (const subdomain of subdomains) {
            const deploymentId = uuidv4();
            const isBaseDomain = subdomain === projectName;
            const url = `https://${subdomain}.stackforgeengine.com`;

            writeChunk(`Processing subdomain: ${subdomain}, isBaseDomain: ${isBaseDomain}, projectName: ${projectName}\n`);

            const domainDetailsResult = await pool.query(
                `SELECT repository, branch, root_directory, output_directory, install_command, build_command, env_vars, domain_id
                 FROM domains
                 WHERE domain_name = $1 AND project_id = $2`,
                [subdomain, projectID]
            );
            if (domainDetailsResult.rows.length === 0) {
                writeChunk(`Domain ${subdomain} not found\n`);
                res.status(404).end();
                return;
            }
            const domainDetails = domainDetailsResult.rows[0];
            const domainId = domainDetails.domain_id;
            const config = {
                repository: repository || domainDetails.repository,
                branch: branch || domainDetails.branch || "main",
                rootDirectory: rootDirectory || domainDetails.root_directory || ".",
                outputDirectory: outputDirectory || domainDetails.output_directory || "",
                buildCommand: buildCommand || domainDetails.build_command || "",
                installCommand: installCommand || domainDetails.install_command || "npm install",
                envVars: envVars || (domainDetails.env_vars ? JSON.parse(domainDetails.env_vars) : [])
            };
            writeChunk(`Config for subdomain ${subdomain}: ${JSON.stringify(config)}\n`);
            writeChunk(`Ensuring ECR repository for projectName: ${projectName}\n`);
            await deployManager.ensureECRRepo(projectName);

            writeChunk(`Creating CodeBuild project: projectName=${projectName}, subdomain=${isBaseDomain ? null : subdomain}\n`);
            await deployManager.createCodeBuildProject({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                repository: config.repository,
                branch: config.branch,
                rootDirectory: config.rootDirectory,
                installCommand: config.installCommand,
                buildCommand: config.buildCommand,
                outputDirectory: config.outputDirectory,
                githubAccessToken
            });

            writeChunk(`Starting CodeBuild: projectName=${projectName}, subdomain=${isBaseDomain ? null : subdomain}\n`);
            const imageUri = await deployManager.streamCodeBuild(
                {
                    projectName,
                    subdomain: isBaseDomain ? null : subdomain,
                    repository: config.repository,
                    branch: config.branch,
                    githubAccessToken
                },
                capturingOnData
            );
            writeChunk(`CodeBuild completed: imageUri=${imageUri}\n`);
            writeChunk(`Creating task definition: projectName=${projectName}, subdomain=${isBaseDomain ? null : subdomain}\n`);
            const taskDefArn = await deployManager.createTaskDef({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                imageUri,
                envVars: config.envVars
            });
            writeChunk(`Task definition created: taskDefArn=${taskDefArn}\n`);
            writeChunk(`Ensuring target group: projectName=${projectName}, subdomain=${isBaseDomain ? null : subdomain}\n`);
            const targetGroupArn = await deployManager.ensureTargetGroup(projectName, isBaseDomain ? null : subdomain);
            writeChunk(`Target group ensured: targetGroupArn=${targetGroupArn}\n`);
            writeChunk(`Creating/updating ECS service: projectName=${projectName}, subdomain=${isBaseDomain ? null : subdomain}\n`);
            await deployManager.createOrUpdateService({
                projectName,
                subdomain: isBaseDomain ? null : subdomain,
                taskDefArn,
                targetGroupArn
            });

            writeChunk(`Updating deployments table for deploymentId: ${deploymentId}\n`);
            await pool.query(
                "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND domain_id = $4 AND status = $5",
                ["inactive", timestamp, projectID, domainId, "active"]
            );
            await pool.query(
                `INSERT INTO deployments 
                 (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                [
                    organizationID,
                    userID,
                    deploymentId,
                    projectID,
                    domainId,
                    "active",
                    url,
                    "default",
                    timestamp,
                    timestamp,
                    timestamp,
                    taskDefArn,
                    commitSha,
                    config.rootDirectory,
                    config.outputDirectory,
                    config.buildCommand,
                    config.installCommand,
                    JSON.stringify(config.envVars)
                ]
            );

            writeChunk(`Updating domains table for subdomain: ${subdomain}\n`);
            await pool.query(
                `UPDATE domains
                 SET repository = $1, branch = $2, root_directory = $3, output_directory = $4, build_command = $5, install_command = $6, env_vars = $7, deployment_id = $8, updated_at = $9
                 WHERE domain_name = $10 AND project_id = $11`,
                [
                    config.repository,
                    config.branch,
                    config.rootDirectory,
                    config.outputDirectory,
                    config.buildCommand,
                    config.installCommand,
                    JSON.stringify(config.envVars),
                    deploymentId,
                    timestamp,
                    subdomain,
                    projectID
                ]
            );

            writeChunk(`Logging deployment: deploymentId=${deploymentId}\n`);
            await pool.query(
                `INSERT INTO deployment_logs 
                 (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    organizationID,
                    userID,
                    projectID,
                    projectName,
                    "update",
                    deploymentId,
                    timestamp,
                    "127.0.0.1"
                ]
            );

            writeChunk(`Updating DNS records for projectName: ${projectName}, subdomains: ${subdomains.join(", ")}\n`);
            await deployManager.updateDNSRecord(projectName, subdomains, targetGroupArn);

            writeChunk(`Recording build logs for deploymentId: ${deploymentId}\n`);
            await deployManager.recordBuildLogs(organizationID, userID, deploymentId, logDir, streamBuffer);
            writeChunk(`Recording runtime logs for deploymentId: ${deploymentId}\n`);
            await deployManager.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);

            results.push({ subdomain, url, deploymentId, taskDefArn });
        }

        writeChunk(`Update completed successfully for subdomains: ${subdomains.join(", ")}\n`);
        res.write(JSON.stringify({
            message: `Successfully updated project ${projectName} for subdomains: ${subdomains.join(", ")}.`,
            results
        }));
        res.end();
    } catch (error) {
        writeChunk(`Error updating project: ${error.message}\n`);
        if (!res.headersSent) {
            return res.status(500).json({ message: error.message });
        }
        next(error);
    }
});

router.post("/delete-project", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, projectName, domainName } = req.body;

    if (!organizationID || !userID || !projectID || !projectName || !domainName) {
        return res.status(400).json({
            message: "Missing required parameters: organizationID, userID, projectID, projectName, and domainName are required."
        });
    }

    try {
        const result = await deployManager.deleteProject({
            userID,
            organizationID,
            projectID,
            projectName,
            domainName
        });
        res.status(200).json(result);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: error.message });
        }
        next(error);
    }
});

router.post("/rollback-deployment", authenticateToken, async (req, res, next) => {
    const { organizationID, userID, projectID, deploymentID } = req.body;

    if (!organizationID || !userID || !projectID || !deploymentID) {
        return res.status(400).json({
            message: "Missing required parameters: organizationID, userID, projectID, and deploymentID are required."
        });
    }

    try {
        const result = await deployManager.rollbackDeployment({
            organizationID,
            userID,
            projectID,
            deploymentID
        });
        res.status(200).json(result);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: error.message });
        }
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

router.post("/project-details", authenticateToken, async (req, res, next) => {
    const { organizationID, userID, projectID } = req.body;
    try {
        const projectResult = await pool.query(
            "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0)
            return res.status(404).json({ message: "Project not found or access denied." });
        const project = projectResult.rows[0];
        const domainsResult = await pool.query("SELECT * FROM domains WHERE project_id = $1 AND orgid = $2", [
            projectID,
            organizationID
        ]);
        const deploymentsResult = await pool.query("SELECT * FROM deployments WHERE project_id = $1 AND orgid = $2", [
            projectID,
            organizationID
        ]);
        return res.status(200).json({ project, domains: domainsResult.rows, deployments: deploymentsResult.rows });
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        next(error);
    }
});











module.exports = router;
