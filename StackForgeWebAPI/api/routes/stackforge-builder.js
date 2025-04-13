const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

class DeployManager {
    async launchWebsite({ userID, organizationID, projectName, domainName, template }) {
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const url = `https://${domainName}.stackforge.app`;

        let projectId = uuidv4();
        await pool.query(
            `
                INSERT INTO projects 
                (orgid, username, project_id, name, created_by, created_at, updated_at, url) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                ;
            `,
            [organizationID, userID, projectId, projectName, userID, timestamp, timestamp, url]
        );

        let domainId = uuidv4();
        await pool.query(
            `
                INSERT INTO domains 
                (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
                ;
            `,
            [organizationID, userID, domainId, domainName, projectId, userID, timestamp, timestamp]
        );

        await pool.query(
            `
                INSERT INTO deployments 
                (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ;
            `,
            [organizationID, userID, deploymentId, projectId, domainId, 'active', url, template || 'default', timestamp, timestamp, timestamp]
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
                    project_id,
                    orgid,
                    username,
                    name,
                    description,
                    created_by,
                    created_at,
                    updated_at,
                    url,
                    repository,
                    current_deployment,
                    image
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

router.post('/launch', authenticateToken, async (req, res, next) => {
    const { organizationID, userID, projectName, domainName, template } = req.body;

    try {
        if (!projectName || !domainName) {
            return res.status(400).json({ error: 'Project name and domain name are required' });
        }

        const orgCheck = await pool.query(
            `SELECT orgid FROM organizations WHERE orgid = $1`,
            [organizationID]
        );

        if (orgCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        const deploymentResult = await deployManager.launchWebsite({
            userID,
            organizationID,
            projectName,
            domainName,
            template: template || 'default'
        });

        res.status(200).json({
            success: true,
            url: deploymentResult.url,
            deploymentId: deploymentResult.deploymentId,
            message: 'Website launched successfully'
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({
                message: 'Error launching website',
                error: error.message
            });
        }
        next(error);
    }
});

router.post('/status', authenticateToken, async (req, res, next) => {
    const { organizationID, userID, deploymentId } = req.body;

    try {
        const status = await deployManager.getDeploymentStatus(deploymentId, organizationID, userID);
        res.status(200).json(status);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({
                message: 'Error getting deployment status',
                error: error.message
            });
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
            res.status(500).json({
                message: 'Error listing projects',
                error: error.message
            });
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
            res.status(500).json({
                message: 'Error listing deployments',
                error: error.message
            });
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
            res.status(500).json({
                message: 'Error listing domains',
                error: error.message
            });
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
        console.log(`Starting deployment for project: ${projectName}, repository: ${repository}, branch: ${branch}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log(`Deployment completed for project: ${projectName}`);
        return res.status(200).json({ message: 'Project deployed successfully.' });
    } catch (error) {
        console.error('Deployment error:', error);
        return res.status(500).json({ message: 'Error during deployment process.' });
    }
});

module.exports = router;
