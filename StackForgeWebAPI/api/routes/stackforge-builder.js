require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();
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
            if (!projectName || projectName.trim() === "") {
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
            sendLine(`Starting deployment with parameters: userID=${userID}, orgID=${organizationID}, repo=${repository}, branch=${branch}\n`);
            sendLine(`Type of sendLine: ${typeof sendLine}\n`);

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
        return res.status(400).json({ message: "Missing required deployment information." });
    }

    try {
        const domainName = projectName.toLowerCase().replace(/\s+/g, "-");

        try {
            const deploymentResult = await deployManager.launchWebsite({
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
            });

            return res.status(200).json({
                message: "Project deployed successfully.",
                url: deploymentResult.url,
                deploymentId: deploymentResult.deploymentId,
                buildLog: deploymentResult.logPath
            });
        } catch (error) {
            return res.status(500).json({ message: error.message, buildLog: errorlogPath });
        }
    } catch (error) {
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
