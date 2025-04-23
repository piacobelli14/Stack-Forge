const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { pool } = require('../config/db');
const { smtpHost, smtpPort, smtpUser, smtpPassword, emailTransporter } = require('../config/smtp');
const { s3Client, storage, upload, PutObjectCommand } = require('../config/s3');
const { authenticateToken } = require('../middleware/auth');

require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

const router = express.Router();

router.post("/snapshot", authenticateToken, async (req, res, next) => {
    const { projectID, organizationID, userID } = req.body;
    try {
        const projectResult = await pool.query(
            "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
            [projectID, organizationID, userID]
        );
        if (projectResult.rows.length === 0)
            return res.status(404).json({ message: "Project not found or access denied." });
        const url = projectResult.rows[0].url;
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
            const buffer = await page.screenshot();
            await browser.close();
            res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buffer.length });
            return res.end(buffer);
        } catch (error) {
            await browser.close();
            const defaultImagePath = path.join(__dirname, "../public/StackForgeLogo.png");
            const buffer = fs.readFileSync(defaultImagePath);
            res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buffer.length });
            return res.end(buffer);
        }
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        next(error);
    }
});

router.post("/git-commits", authenticateToken, async (req, res, next) => {
    const { userID, owner, repo } = req.body;
    try {
        if (!owner || !repo) return res.status(400).json({ message: "Owner and repository are required." });
        const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (result.rows.length === 0 || !result.rows[0].github_access_token)
            return res.status(400).json({ message: "GitHub account not connected." });
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
            headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
        });
        return res.status(200).json(gitResponse.data);
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        next(error);
    }
});

router.post("/git-commit-details", authenticateToken, async (req, res, next) => {
    const { userID, owner, repo, commitSha } = req.body;
    try {
        if (!owner || !repo || !commitSha)
            return res.status(400).json({ message: "Owner, repository, and commitSha are required." });
        const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (result.rows.length === 0 || !result.rows[0].github_access_token)
            return res.status(400).json({ message: "GitHub account not connected." });
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
            headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
        });
        return res.status(200).json(gitResponse.data);
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        next(error);
    }
});

router.post("/git-analytics", authenticateToken, async (req, res, next) => {
    const { userID, websiteURL, repository, owner, projectName } = req.body;
    let websiteAnalytics = null;
    let repositoryAnalytics = null;

    try {
        if (!websiteURL && !repository) {
            return res.status(400).json({ message: "Either websiteURL or repository is required." });
        }

        if (websiteURL) {
            try {
                const startTime = Date.now();
                let websiteResponse;
                try {
                    websiteResponse = await axios.get(websiteURL, { timeout: 30000 });
                } catch (httpErr) {
                    websiteAnalytics = {
                        status: httpErr.response?.status || 503,
                        responseTime: Date.now() - startTime,
                        contentLength: 0,
                        headers: {
                            server: httpErr.response?.headers?.server || "Unknown",
                            contentType: httpErr.response?.headers?.["content-type"] || "Unknown",
                            cacheControl: httpErr.response?.headers?.["cache-control"] || "Unknown"
                        },
                        performance: {
                            pageLoadTime: 0,
                            scripts: 0,
                            images: 0,
                            links: 0
                        },
                        error: `HTTP request failed: ${httpErr.message}`
                    };
                }
        
                if (websiteResponse) {
                    const responseTime = Date.now() - startTime;
                    let contentLength = websiteResponse.headers["content-length"] || (websiteResponse.data ? websiteResponse.data.toString().length : 0);
        
                    let performanceMetrics = {
                        pageLoadTime: 0,
                        scripts: 0,
                        images: 0,
                        links: 0
                    };
                    try {
                        const browser = await puppeteer.launch({ headless: true });
                        const page = await browser.newPage();
                        await page.goto(websiteURL, { waitUntil: "networkidle2", timeout: 30000 });
                        await new Promise(resolve => setTimeout(resolve, 2000)); 
        
                        performanceMetrics = await page.evaluate(() => {
                            const { loadEventEnd, navigationStart } = performance.timing;
                            const pageLoadTime = loadEventEnd - navigationStart || 0;
                            const scripts = document.querySelectorAll("script").length || 0;
                            const images = document.querySelectorAll("img").length || 0;
                            const links = document.querySelectorAll("a").length || 0;
                            return { pageLoadTime, scripts, images, links };
                        });
        
                        // Verify page content
                        const pageContent = await page.content();
                        if (!pageContent.includes("<html")) {
                        }
        
                        await browser.close();
                    } catch (puppeteerErr) {
                        performanceMetrics = {
                            pageLoadTime: 0,
                            scripts: 0,
                            images: 0,
                            links: 0
                        };
                    }
        
                    websiteAnalytics = {
                        status: websiteResponse.status,
                        responseTime,
                        contentLength,
                        headers: {
                            server: websiteResponse.headers["server"] || "Unknown",
                            contentType: websiteResponse.headers["content-type"] || "Unknown",
                            cacheControl: websiteResponse.headers["cache-control"] || "Unknown"
                        },
                        performance: performanceMetrics,
                        error: null
                    };
                }
            } catch (err) {
                websiteAnalytics = {
                    status: 500,
                    responseTime: 0,
                    contentLength: 0,
                    headers: {
                        server: "Unknown",
                        contentType: "Unknown",
                        cacheControl: "Unknown"
                    },
                    performance: {
                        pageLoadTime: 0,
                        scripts: 0,
                        images: 0,
                        links: 0
                    },
                    error: `Website analytics failed: ${err.message}`
                };
            }
        }

        if (repository) {
            let repoName = repository;
            let repoOwner = owner;
            if (repository.includes("/")) {
                [repoOwner, repoName] = repository.split("/");
            }

            const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
            if (result.rows.length === 0 || !result.rows[0].github_access_token) {
                return res.status(400).json({ message: "GitHub account not connected." });
            }
            const githubAccessToken = result.rows[0].github_access_token;

            try {
                const repoResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
                });

                const ownerResponse = await axios.get(`https://api.github.com/users/${repoOwner}`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
                });

                const commitsResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/commits`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" },
                    params: { per_page: 100 }
                });
                const commitCount = commitsResponse.data.length;

                const contributorsResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/contributors`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
                });
                const contributorCount = contributorsResponse.data.length;
                const topContributors = contributorsResponse.data.slice(0, 5).map(c => ({
                    login: c.login,
                    contributions: c.contributions
                }));

                const branchesResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/branches`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
                });
                const branchCount = branchesResponse.data.length;

                const pullsResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
                    headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" },
                    params: { state: "all", per_page: 100 }
                });
                const pullRequestCount = pullsResponse.data.length;
                const openPulls = pullsResponse.data.filter(pr => pr.state === "open").length;

                repositoryAnalytics = {
                    repoDetails: {
                        name: repoResponse.data.name,
                        fullName: repoResponse.data.full_name,
                        description: repoResponse.data.description,
                        stars: repoResponse.data.stargazers_count,
                        forks: repoResponse.data.forks_count,
                        issues: repoResponse.data.open_issues_count,
                        createdAt: repoResponse.data.created_at,
                        lastUpdated: repoResponse.data.updated_at,
                        ownerAvatar: ownerResponse.data.avatar_url
                    },
                    stats: {
                        commitCount,
                        contributorCount,
                        topContributors,
                        branchCount,
                        pullRequestCount,
                        openPulls
                    }
                };
            } catch (err) {
                repositoryAnalytics = { error: `Repository analytics failed: ${err.message}` };
            }
        }

        return res.status(200).json({
            websiteAnalytics,
            repositoryAnalytics
        });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error processing analytics: ${error.message}.` });
        }
        next(error);
    }
});

router.post("/runtime-logs", authenticateToken, async (req, res, next) => {
    const { organizationID, userID, projectID, deploymentID, timePeriod } = req.body;

    if (!organizationID || !userID || !timePeriod) {
        return res.status(400).json({
            message: "Missing required parameters: organizationID, userID, and timePeriod are required."
        });
    }

    const validPeriods = ['past_30_mins', 'past_hour', 'past_day', 'past_week'];
    if (!validPeriods.includes(timePeriod)) {
        return res.status(400).json({
            message: `Invalid timePeriod. Must be one of: ${validPeriods.join(', ')}.`
        });
    }

    try {
        let timeFilter;
        const now = new Date();
        switch (timePeriod) {
            case 'past_30_mins':
                timeFilter = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
                break;
            case 'past_hour':
                timeFilter = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
                break;
            case 'past_day':
                timeFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
                break;
            case 'past_week':
                timeFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
                break;
        }

        let queryText = `
            SELECT 
                rl.build_log_id,
                rl.timestamp,
                rl.status,
                rl.hostname as host, 
                rl.runtime_path,
                rl.runtime_messages,
                p.name AS project_name,
                d.deployment_id
            FROM runtime_logs rl
            LEFT JOIN deployments d ON rl.deployment_id = d.deployment_id
            LEFT JOIN projects p ON d.project_id = p.project_id
            WHERE rl.orgid = $1 
            AND rl.username = $2
            AND rl.timestamp >= $3
        `;
        const queryParams = [organizationID, userID, timeFilter];
        if (projectID) {
            queryText += ` AND d.project_id = $${queryParams.length + 1}`;
            queryParams.push(projectID);
        }
        if (deploymentID) {
            queryText += ` AND rl.deployment_id = $${queryParams.length + 1}`;
            queryParams.push(deploymentID);
        }
        queryText += ` ORDER BY rl.timestamp DESC`;

        const result = await pool.query(queryText, queryParams);
        res.status(200).json({
            projectId: projectID || null,
            deploymentId: deploymentID || null,
            timePeriod,
            logs: result.rows
        });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error fetching runtime logs: ${error.message}.` });
        }
        next(error);
    }
});

router.post("/build-logs", authenticateToken, async (req, res, next) => {
    const { organizationID, userID, deploymentID, timePeriod } = req.body;
    if (!organizationID || !userID || !deploymentID)
        return res.status(400).json({ message: "Missing required parameters: organizationID, userID, and deploymentID are required." });
    let timeFilter;
    const now = new Date();
    switch (timePeriod) {
        case 'past_30_mins':
            timeFilter = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
            break;
        case 'past_hour':
            timeFilter = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
            break;
        case 'past_day':
            timeFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
            break;
        case 'past_week':
            timeFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
            break;
        default:
            timeFilter = null;
    }
    try {
        const queryParams = [organizationID, userID, deploymentID];
        let queryText = `
            SELECT 
                orgid,
                username,
                deployment_id,
                build_log_id,
                timestamp,
                log_path,
                log_messages
            FROM build_logs
            WHERE orgid = $1
              AND username = $2
              AND deployment_id = $3
        `;
        if (timeFilter) {
            queryText += ` AND timestamp >= $4`;
            queryParams.push(timeFilter);
        }
        queryText += ` ORDER BY timestamp DESC`;
        const result = await pool.query(queryText, queryParams);
        const splitLogs = result.rows.flatMap(row =>
            row.log_messages
                .split("\n")
                .filter(line => line.trim())
                .map(line => ({
                    build_log_id: row.build_log_id,
                    timestamp: row.timestamp,
                    log_path: row.log_path,
                    log_messages: line
                }))
        );
        res.status(200).json({ logs: splitLogs });
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: `Error fetching build logs: ${error.message}.` });
        next(error);
    }
});

router.post('/edit-project-image', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, image } = req.body;

    req.on('close', () => {
        return;
    });

    if (!userID || !organizationID || !projectID || !image) {
        return res.status(400).json({ message: 'User ID, Organization ID, projectID, and image are required.' });
    }

    try {
        const matches = image.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ message: 'Invalid image format.' });
        }
        const mimeType = matches[1];
        const imageBuffer = Buffer.from(matches[2], 'base64');
        const extension = mimeType.split('/')[1];

        const imageName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;

        const uploadParams = {
            Bucket: process.env.S3_IMAGE_BUCKET_NAME,
            Key: `uploads/${imageName}`,
            Body: imageBuffer,
            ContentType: mimeType,
        };

        const data = await s3Client.send(new PutObjectCommand(uploadParams));
        const imageUrl = `https://${uploadParams.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;

        const updateImageQuery = `
            UPDATE projects
            SET image = $1
            WHERE orgid = $2 AND project_id = $3 AND username = $4
        `;

        const updateImageInfo = await pool.query(updateImageQuery, [imageUrl, organizationID, projectID, userID]);
        if (updateImageInfo.rowCount === 0) {
            return res.status(404).json({ message: 'Project not found or image not updated.' });
        }
        return res.status(200).json({ message: 'Project image updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

router.post('/edit-project-name', authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, projectName } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        const updateProjectNameQuery = `
            UPDATE projects
            SET name = $1
            WHERE username = $2 AND orgid = $3 AND project_id = $4
        `;
        const updateProjectNameInfo = await pool.query(updateProjectNameQuery, [projectName, userID, organizationID, projectID]);

        const updateDeploymentLogsQuery = `
            UPDATE deployment_logs
            SET project_name = $1
            WHERE project_id = $2
        `;
        const updateDeploymentLogsInfo = await pool.query(updateDeploymentLogsQuery, [projectName, projectID]);

        if (updateProjectNameInfo.rowCount === 0) {
            return res.status(500).json({ message: 'No project found to update. Please try again.' });
        }

        return res.status(200).json({ message: 'Project name updated successfully.' });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
        }
        next(error);
    }
});

module.exports = router;
