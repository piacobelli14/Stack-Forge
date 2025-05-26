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
    const { domainName } = req.body;    
    try {
        if (!domainName || typeof domainName !== "string" || !domainName.trim()) {
            return res
                .status(400)
                .json({ message: "domainName (sub‑domain) is required." });
        }

        const cleanedSub = domainName.trim().toLowerCase();
        const targetUrl = `https://${cleanedSub}.stackforgeengine.com`;
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        try {
            await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 });
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
            return res
                .status(500)
                .json({ message: "Unexpected server error while generating snapshot." });
        }
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

router.post("/git-commit-details-file-content", authenticateToken, async (req, res, next) => {
    const { userID, owner, repo, ref, filePath } = req.body;
    try {
        if (!owner || !repo || !ref || !filePath)
            return res.status(400).json({ message: "owner, repo, ref, and filePath are required." });

        const result = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (result.rows.length === 0 || !result.rows[0].github_access_token)
            return res.status(400).json({ message: "GitHub account not connected." });

        const githubAccessToken = result.rows[0].github_access_token;

        let repoOwner = owner;
        let repoName = repo;
        if (repo.includes("/")) {
            [repoOwner, repoName] = repo.split("/");
        }

        const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(filePath)}?ref=${ref}`;
        const gitResponse = await axios.get(url, {
            headers: {
                Authorization: `token ${githubAccessToken}`,
                Accept: "application/vnd.github.v3.raw"
            },
            responseType: "arraybuffer"
        });

        const contentBuffer = Buffer.from(gitResponse.data, "binary");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end(contentBuffer);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error fetching file content: ${error.message}` });
        }
        next(error);
    }
});

router.post("/git-analytics", authenticateToken, async (req, res, next) => {
    const { userID, websiteURL, domainName, repository, owner, projectName } = req.body;
    let websiteAnalytics = null;
    let repositoryAnalytics = null;

    try {
        if (!websiteURL && !domainName && !repository) {
            return res.status(400).json({ message: "Either websiteURL/domainName or repository is required." });
        }

        let resolvedWebsiteURL = websiteURL;
        if (!resolvedWebsiteURL && domainName) {
            const domainLookup = await pool.query(
                "SELECT url FROM domains WHERE domain_name = $1",
                [domainName]
            );
            if (domainLookup.rows.length > 0) {
                resolvedWebsiteURL = domainLookup.rows[0].url;
            }
        }

        let deploymentStatus = null;
        if (resolvedWebsiteURL) {
            try {
                const deploymentResult = await pool.query(
                    "SELECT deployment_id, url FROM deployments WHERE url = $1",
                    [resolvedWebsiteURL]
                );

                if (deploymentResult.rows.length > 0) {
                    const { deployment_id } = deploymentResult.rows[0];
                    const browser = await puppeteer.launch({ headless: true });
                    const page = await browser.newPage();
                    let status = 'inactive';

                    try {
                        const response = await page.goto(resolvedWebsiteURL, { waitUntil: "networkidle2", timeout: 30000 });
                        const responseStatus = response ? response.status() : null;
                        if (responseStatus && responseStatus >= 200 && responseStatus < 300) {
                            status = 'active';
                        }
                    } catch (error) {
                        status = 'inactive';
                    } finally {
                        await browser.close();
                    }

                    const updateResult = await pool.query(
                        "UPDATE deployments SET status = $1 WHERE deployment_id = $2 RETURNING status",
                        [status, deployment_id]
                    );
                    deploymentStatus = updateResult.rows[0].status;
                }
            } catch (error) {}
        }

        if (resolvedWebsiteURL) {
            try {
                const startTime = Date.now();
                let websiteResponse;
                try {
                    websiteResponse = await axios.get(resolvedWebsiteURL, { timeout: 30000 });
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
                        error: `HTTP request failed: ${httpErr.message}`,
                        deploymentStatus
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
                        await page.goto(resolvedWebsiteURL, { waitUntil: "networkidle2", timeout: 30000 });
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        performanceMetrics = await page.evaluate(() => {
                            const { loadEventEnd, navigationStart } = performance.timing;
                            const pageLoadTime = loadEventEnd - navigationStart || 0;
                            const scripts = document.querySelectorAll("script").length || 0;
                            const images = document.querySelectorAll("img").length || 0;
                            const links = document.querySelectorAll("a").length || 0;
                            return { pageLoadTime, scripts, images, links };
                        });

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
                        error: null,
                        deploymentStatus
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
                    error: `Website analytics failed: ${err.message}`,
                    deploymentStatus
                };
            }
        }

        if (repository) {
            try {
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

        const finalResponse = { websiteAnalytics, repositoryAnalytics };
        return res.status(200).json(finalResponse);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error processing analytics: ${error.message}.` });
        }
        next(error);
    }
});

router.post("/git-repo-updates", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, owner, repo, projectID, domainName } = req.body;
    try {
        if (!owner || !repo || !projectID || !organizationID) {
            return res.status(400).json({ message: "Owner, repository, projectID, and organizationID are required." });
        }
        const userResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (userResult.rows.length === 0 || !userResult.rows[0].github_access_token) {
            return res.status(400).json({ message: "GitHub account not connected." });
        }
        const githubAccessToken = userResult.rows[0].github_access_token;
        let repoOwner = owner;
        let repoName = repo;
        if (repo.includes("/")) {
            [repoOwner, repoName] = repo.split("/");
        }
        let deploymentResult;
        if (domainName) {
            const domainLookup = await pool.query(
                "SELECT domain_id FROM domains WHERE domain_name = $1 AND project_id = $2 AND orgid = $3",
                [domainName, projectID, organizationID]
            );
            if (domainLookup.rows.length === 0) {
                return res.status(404).json({ message: "Domain not found for this project." });
            }
            const domainId = domainLookup.rows[0].domain_id;
            deploymentResult = await pool.query(
                `SELECT commit_sha, last_deployed_at
                 FROM deployments
                 WHERE project_id = $1 AND orgid = $2 AND domain_id = $3
                 ORDER BY last_deployed_at DESC
                 LIMIT 1`,
                [projectID, organizationID, domainId]
            );
        } else {
            deploymentResult = await pool.query(
                `SELECT commit_sha, last_deployed_at
                 FROM deployments
                 WHERE project_id = $1 AND orgid = $2
                 ORDER BY last_deployed_at DESC
                 LIMIT 1`,
                [projectID, organizationID]
            );
        }
        if (deploymentResult.rows.length === 0) {
            return res.status(404).json({ message: "No deployments found for this project." });
        }
        const lastDeploymentCommit = deploymentResult.rows[0].commit_sha;
        const lastDeployedAtRaw = deploymentResult.rows[0].last_deployed_at;
        const lastDeployedAtUtc = new Date(Date.UTC(
            lastDeployedAtRaw.getFullYear(),
            lastDeployedAtRaw.getMonth(),
            lastDeployedAtRaw.getDate(),
            lastDeployedAtRaw.getHours(),
            lastDeployedAtRaw.getMinutes(),
            lastDeployedAtRaw.getSeconds(),
            lastDeployedAtRaw.getMilliseconds()
        ));
        const repoMeta = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
            headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
        });
        const defaultBranch = repoMeta.data.default_branch;
        const gitResponse = await axios.get(
            `https://api.github.com/repos/${repoOwner}/${repoName}/commits`,
            {
                headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" },
                params: { sha: defaultBranch, since: lastDeployedAtUtc.toISOString(), per_page: 100 }
            }
        );
        if (!gitResponse.data || gitResponse.data.length === 0) {
            return res.status(404).json({ message: "No commits found in the repository since the last deployment." });
        }
        const newCommits = gitResponse.data.filter(c => c.sha !== lastDeploymentCommit);
        const hasUpdates = newCommits.length > 0;
        return res.status(200).json({ hasUpdates, lastDeploymentCommit, newCommitsCount: newCommits.length, newCommits });
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error checking repository updates: ${error.message}` });
        }
        next(error);
    }
});

router.post("/git-commits", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, owner, repo, domainName } = req.body;
    try {
        if (!userID || !organizationID || !projectID || !owner || !repo) {
            return res.status(400).json({ message: "userID, organizationID, projectID, owner, and repo are required." });
        }
        const userResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (userResult.rows.length === 0 || !userResult.rows[0].github_access_token) {
            return res.status(400).json({ message: "GitHub account not connected." });
        }
        const githubAccessToken = userResult.rows[0].github_access_token;
        let repoOwner = owner;
        let repoName = repo;
        if (repo.includes("/")) {
            [repoOwner, repoName] = repo.split("/");
        }
        let deploymentQuery = `
            SELECT commit_sha
            FROM deployments
            WHERE project_id = $1 AND orgid = $2
        `;
        const queryParams = [projectID, organizationID];
        if (domainName) {
            deploymentQuery += ` AND domain_id = (SELECT domain_id FROM domains WHERE domain_name = $3 AND project_id = $1 AND orgid = $2)`;
            queryParams.push(domainName);
        }
        deploymentQuery += ` ORDER BY last_deployed_at DESC LIMIT 50`;
        const deploymentRows = await pool.query(deploymentQuery, queryParams);
        const commitShas = [...new Set(deploymentRows.rows.map(r => r.commit_sha))].slice(0, 50);
        if (commitShas.length === 0) {
            return res.status(404).json({ message: "No deployments found for the specified criteria." });
        }
        const commitPromises = commitShas.map(sha =>
            axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/${sha}`, {
                headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
            }).then(res => res.data)
        );
        const commits = await Promise.all(commitPromises);
        return res.status(200).json(commits);
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error fetching commits: ${error.message}` });
        }
        next(error);
    }
});

router.post("/git-repo-update-details-relative-to-deployment", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, owner, repo, commitSha, domainName } = req.body;

    try {
        if (!userID || !organizationID || !projectID || !owner || !repo || !commitSha) {
            return res.status(400).json({ message: "userID, organizationID, projectID, owner, repo, and commitSha are required." });
        }

        const userResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (userResult.rows.length === 0 || !userResult.rows[0].github_access_token) {
            return res.status(400).json({ message: "GitHub account not connected." });
        }

        const githubAccessToken = userResult.rows[0].github_access_token;

        let repoName = repo;
        let repoOwner = owner;
        if (repo.includes("/")) {
            [repoOwner, repoName] = repo.split("/");
        }

        let deploymentResult;
        if (domainName) {
            deploymentResult = await pool.query(
                `SELECT d.commit_sha, d.last_deployed_at
                 FROM deployments d
                 JOIN domains dom ON dom.domain_id = d.domain_id
                 WHERE d.project_id = $1 AND d.orgid = $2 AND dom.domain_name = $3
                 ORDER BY d.last_deployed_at DESC
                 LIMIT 1`,
                [projectID, organizationID, domainName]
            );
        } else {
            deploymentResult = await pool.query(
                `SELECT commit_sha, last_deployed_at
                 FROM deployments
                 WHERE project_id = $1 AND orgid = $2
                 ORDER BY last_deployed_at DESC
                 LIMIT 1`,
                [projectID, organizationID]
            );
        }

        if (deploymentResult.rows.length === 0) {
            return res.status(404).json({ message: "No deployments found for this project." });
        }

        const { commit_sha: lastDeploymentCommit, last_deployed_at: lastDeployedAtRaw } = deploymentResult.rows[0];
        const deploymentDate = new Date(Date.UTC(
            lastDeployedAtRaw.getFullYear(),
            lastDeployedAtRaw.getMonth(),
            lastDeployedAtRaw.getDate(),
            lastDeployedAtRaw.getHours(),
            lastDeployedAtRaw.getMinutes(),
            lastDeployedAtRaw.getSeconds(),
            lastDeployedAtRaw.getMilliseconds()
        ));

        const commitUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${commitSha}`;
        let commitResponse;
        try {
            commitResponse = await axios.get(commitUrl, {
                headers: {
                    Authorization: `token ${githubAccessToken}`,
                    Accept: "application/vnd.github.v3+json"
                }
            });
        } catch (error) {
            if (error.response?.status === 404) {
                return res.status(404).json({ message: "Commit not found in the repository." });
            }
            throw error;
        }

        const commitDate = new Date(commitResponse.data.commit.committer.date);

        let status;
        if (commitDate < deploymentDate) {
            status = "before";
        } else if (commitDate > deploymentDate) {
            status = "after";
        } else {
            status = "same";
        }

        const response = {
            commitSha,
            commitDate: commitDate.toISOString(),
            lastDeploymentCommit,
            lastDeploymentDate: deploymentDate.toISOString(),
            status,
            domainName: domainName || null
        };

        return res.status(200).json(response);

    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: `Error checking commit relative to deployment: ${error.message}` });
        }
        next(error);
    }
});

router.post("/fetch-current-build-info", authenticateToken, async (req, res, next) => {
    const { userID, organizationID, projectID, domainName } = req.body;

    req.on('close', () => {
        return;
    });

    try {
        let domainIdFilter = null;
        if (domainName) {
            const domainLookup = await pool.query(
                "SELECT domain_id FROM domains WHERE domain_name = $1 AND project_id = $2 AND orgid = $3",
                [domainName, projectID, organizationID]
            );
            if (domainLookup.rows.length > 0) {
                domainIdFilter = domainLookup.rows[0].domain_id;
            } else {
                return res.status(404).json({ message: 'Domain not found for this project.' });
            }
        }

        const projectInfoFetchQuery = `
            SELECT 
                root_directory, 
                output_directory, 
                build_command, 
                install_command, 
                env_vars, 
                domain_id
            FROM deployments
            WHERE orgid = $1
            AND username = $2
            AND project_id = $3
            ${domainIdFilter ? `AND domain_id = '${domainIdFilter}'` : ''}
            ORDER BY last_deployed_at DESC
            LIMIT 1
        `;

        const projectInfo = await pool.query(projectInfoFetchQuery, [organizationID, userID, projectID]);

        if (projectInfo.rows.length === 0) {
            return res.status(404).json({ message: 'No production deployment found for this project.' });
        }

        res.status(200).json({
            root_directory: projectInfo.rows[0].root_directory,
            output_directory: projectInfo.rows[0].output_directory,
            build_command: projectInfo.rows[0].build_command,
            install_command: projectInfo.rows[0].install_command,
            env_vars: projectInfo.rows[0].env_vars,
            domain_id: projectInfo.rows[0].domain_id
        });

    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).json({ message: 'Error connecting to the database. Please try again later.' });
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
            return res.status(400).json({ message: 'No project found to update. Please try again.' });
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