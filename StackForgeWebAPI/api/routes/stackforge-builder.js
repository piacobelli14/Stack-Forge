const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class DeployManager {
    async launchWebsite({ userID, organizationID, projectName, domainName, template, repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars }) {
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const url = `https://${domainName}.stackforge.app`;
        const projectID = uuidv4();
        await pool.query(
            `
            INSERT INTO projects 
            (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, current_deployment, image) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT DO NOTHING
            ;
            `,
            [organizationID, userID, projectID, projectName, null, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), userID, timestamp, timestamp, url, repository, deploymentId, null]
        );
        const domainId = uuidv4();
        await pool.query(
            `
            INSERT INTO domains 
            (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING
            ;
            `,
            [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
        );
        await pool.query(
            `
            INSERT INTO deployments 
            (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ;
            `,
            [organizationID, userID, deploymentId, projectID, domainId, 'active', url, template || 'default', timestamp, timestamp, timestamp]
        );
        await pool.query(
            `
            INSERT INTO deployment_logs 
            (orgid, username, action, deployment_id, timestamp, ip_address) 
            VALUES ($1, $2, $3, $4, $5, $6)
            ;
            `,
            [organizationID, userID, 'launch', deploymentId, timestamp, '127.0.0.1']
        );
        return { url, deploymentId };
    }
    async getDeploymentStatus(deploymentId, organizationID, userID) {
        const result = await pool.query(
            `
            SELECT 
                d.*,
                p.name AS project_name,
                dm.domain_name AS domain,
                o.orgname 
            FROM deployments d
            LEFT JOIN projects p ON d.project_id = p.project_id
            LEFT JOIN domains dm ON d.domain_id = dm.domain_id
            JOIN organizations o ON d.orgid = o.orgid
            WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3
            ;
            `,
            [deploymentId, organizationID, userID]
        );
        if (result.rows.length === 0) {
            throw new Error('Deployment not found or access denied');
        }
        return result.rows[0];
    }
    async listDeployments(organizationID) {
        const result = await pool.query(
            `
            SELECT 
                d.deployment_id,
                d.orgid,
                d.username,
                d.status,
                d.url,
                d.template,
                d.created_at,
                d.updated_at,
                d.last_deployed_at,
                p.name AS project_name,
                dm.domain_name AS domain,
                o.orgname,
                p.url AS project_url,
                p.repository,
                p.current_deployment
            FROM deployments d
            LEFT JOIN projects p ON d.project_id = p.project_id
            LEFT JOIN domains dm ON d.domain_id = dm.domain_id
            JOIN organizations o ON d.orgid = o.orgid
            WHERE d.orgid = $1
            ORDER BY d.created_at DESC
            ;
            `,
            [organizationID]
        );
        return result.rows;
    }
    async listProjects(organizationID) {
        const result = await pool.query(
            `
            SELECT 
                *
            FROM projects
            WHERE orgid = $1
            ORDER BY created_at DESC
            ;
            `,
            [organizationID]
        );
        return result.rows;
    }
    async listDomains(organizationID) {
        const result = await pool.query(
            `
            SELECT 
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
            ORDER BY created_at DESC
            ;
            `,
            [organizationID]
        );
        return result.rows;
    }
}

const deployManager = new DeployManager();

router.post('/status', authenticateToken, async (req, res, next) => {
    const { organizationID, userID, deploymentId } = req.body;
    try {
        const status = await deployManager.getDeploymentStatus(deploymentId, organizationID, userID);
        res.status(200).json(status);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/list-projects', authenticateToken, async (req, res, next) => {
    const organizationID = req.body.organizationID;
    try {
        const projects = await deployManager.listProjects(organizationID);
        res.status(200).json(projects);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/list-deployments', authenticateToken, async (req, res, next) => {
    const organizationID = req.body.organizationID;
    try {
        const deployments = await deployManager.listDeployments(organizationID);
        res.status(200).json(deployments);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/list-domains', authenticateToken, async (req, res, next) => {
    const organizationID = req.body.organizationID;
    try {
        const domains = await deployManager.listDomains(organizationID);
        res.status(200).json(domains);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/deploy-project', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, repository, branch, teamName, projectName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars } = req.body;
    if (!repository || !branch || !projectName) {
        return res.status(400).json({ message: 'Missing required deployment information.' });
    }
    try {
        const existingProjectResult = await pool.query(
            'SELECT * FROM projects WHERE orgid = $1 AND username = $2 AND name = $3',
            [organizationID, userID, projectName]
        );
        if (existingProjectResult.rows.length > 0) {
            return res.status(400).json({ message: 'A project with the same name already exists for this user and organization.' });
        }
        const domainName = projectName.toLowerCase().replace(/\s+/g, '-');
        const deploymentResult = await deployManager.launchWebsite({
            userID,
            organizationID,
            projectName,
            domainName,
            template: 'default',
            repository,
            branch,
            teamName,
            rootDirectory,
            outputDirectory,
            buildCommand,
            installCommand,
            envVars
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
        return res.status(200).json({
            message: 'Project deployed successfully.',
            url: deploymentResult.url,
            deploymentId: deploymentResult.deploymentId
        });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/project-details', authenticateToken, async (req, res, next) => {
    const { organizationID, userID, projectID } = req.body;
    try {
        const projectResult = await pool.query(
            `SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3`,
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ message: 'Project not found or access denied.' });
        }
        const project = projectResult.rows[0];
        const domainsResult = await pool.query(
            `SELECT * FROM domains WHERE project_id = $1 AND orgid = $2`,
            [projectID, organizationID]
        );
        const deploymentsResult = await pool.query(
            `SELECT * FROM deployments WHERE project_id = $1 AND orgid = $2`,
            [projectID, organizationID]
        );
        return res.status(200).json({ project, domains: domainsResult.rows, deployments: deploymentsResult.rows });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/snapshot', authenticateToken, async (req, res, next) => {
    const { projectID, organizationID, userID } = req.body;
    try {
        const projectResult = await pool.query(
            `SELECT url FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3`,
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0) {
            return res.status(404).json({ message: 'Project not found or access denied.' });
        }
        const url = projectResult.rows[0].url;
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            const buffer = await page.screenshot();
            await browser.close();
            res.writeHead(200, {
                "Content-Type": "image/png",
                "Content-Length": buffer.length
            });
            return res.end(buffer);
        } catch (error) {
            await browser.close();
            const defaultImagePath = path.join(__dirname, '../public/StackForgeLogo.png');
            const buffer = fs.readFileSync(defaultImagePath);
            res.writeHead(200, {
                "Content-Type": "image/png",
                "Content-Length": buffer.length
            });
            return res.end(buffer);
        }
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/git-commits', authenticateToken, async (req, res, next) => {
    const { userID, owner, repo } = req.body;
    try {
        if (!owner || !repo) {
            return res.status(400).json({ message: 'Owner and repository are required.' });
        }
        const result = await pool.query('SELECT github_access_token FROM users WHERE username = $1', [userID]);
        if (result.rows.length === 0 || !result.rows[0].github_access_token) {
            return res.status(400).json({ message: 'GitHub account not connected.' });
        }
        const githubAccessToken = result.rows[0].github_access_token;
        const gitResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits`, {
            headers: {
                Authorization: `token ${githubAccessToken}`,
                Accept: 'application/json'
            }
        });
        return res.status(200).json(gitResponse.data);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

module.exports = router;
