const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class DeployManager {
    async launchWebsite({ userID, organizationID, projectName, domainName, template }) {
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const url = `https://${domainName}.stackforge.app`;
        await pool.query(
            `
                INSERT INTO deployments 
                (deployment_id, orgid, username, project_name, domain, status, url, created_at) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [deploymentId, organizationID, userID, projectName, domainName, 'active', url, timestamp]
        );
        await pool.query(
            `
                INSERT INTO deployment_logs 
                (orgid, username, action, deployment_id, timestamp, ip_address) 
                VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [organizationID, userID, 'launch', deploymentId, timestamp, '127.0.0.1']
        );
        return { url, deploymentId };
    }

    async getDeploymentStatus(deploymentId, organizationID, userID) {
        const result = await pool.query(
            `
                SELECT d.*, o.orgname 
                FROM deployments d
                JOIN organizations o ON d.orgid = o.orgid
                WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3
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
                SELECT d.*, o.orgname 
                FROM deployments d
                JOIN organizations o ON d.orgid = o.orgid
                WHERE d.orgid = $1
                ORDER BY d.created_at DESC
            `,
            [organizationID]
        );
        return result.rows;
    }
}

const deployManager = new DeployManager();

router.post('/launch', authenticateToken, async (req, res) => {
    const { organizationID, userID, projectName, domainName, template } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        if (!projectName || !domainName) {
            return res.status(400).json({ error: 'Project name and domain name are required' });
        }

        const orgCheck = await pool.query(
            'SELECT orgid FROM organizations WHERE orgid = $1',
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
            res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/status', authenticateToken, async (req, res) => {
    const { organizationID, userID, deploymentId } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const status = await deployManager.getDeploymentStatus(deploymentId, organizationID, userID);
        res.status(200).json(status);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/list', authenticateToken, async (req, res) => {
    const organizationID = req.body.organizationID;

    req.on('close', () => {
        return;
    });

    try {
        const deployments = await deployManager.listDeployments(organizationID);
        res.status(200).json(deployments);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

module.exports = router;
