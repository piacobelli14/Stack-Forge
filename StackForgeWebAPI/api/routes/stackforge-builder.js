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
const { Route53Client, ChangeResourceRecordSetsCommand, ListResourceRecordSetsCommand } = require("@aws-sdk/client-route-53");
const { ECRClient, DescribeRepositoriesCommand, CreateRepositoryCommand, GetAuthorizationTokenCommand } = require("@aws-sdk/client-ecr");
const { ECSClient, RegisterTaskDefinitionCommand, DescribeServicesCommand, CreateServiceCommand, UpdateServiceCommand } = require("@aws-sdk/client-ecs");
const { ElasticLoadBalancingV2Client, DescribeRulesCommand, CreateRuleCommand, ModifyRuleCommand, DescribeTargetGroupsCommand, CreateTargetGroupCommand } = require("@aws-sdk/client-elastic-load-balancing-v2");
const route53Client = new Route53Client({ region: process.env.AWS_REGION });

class DeployManager {
    constructor() {
        this.ecr = new ECRClient({ region: process.env.AWS_REGION });
        this.ecs = new ECSClient({ region: process.env.AWS_REGION });
        this.elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
    }

    commandExists(cmd) {
        try {
            const result = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
            if (result.status === 0) return true;
            return false;
        } catch {
            return false;
        }
    }

    runCommand(cmd, cwd, env, mainLogPath) {
        const commandLogPath = path.join(path.dirname(mainLogPath), `cmd-${uuidv4()}.log`);
        fs.writeFileSync(commandLogPath, "");

        fs.appendFileSync(mainLogPath, `\n> Running command: ${cmd}\n`);
        if (cwd) fs.appendFileSync(mainLogPath, `CWD: ${cwd}\n`);

        const parts = cmd.split(" ");
        const shellCmd = `${cmd} >> ${commandLogPath} 2>&1`;
        const result = spawnSync(parts[0], parts.slice(1), {
            cwd,
            env,
            shell: true,
            stdio: ["ignore", "ignore", "ignore"]
        });

        const commandOutput = fs.readFileSync(commandLogPath, "utf-8");
        fs.appendFileSync(mainLogPath, commandOutput);
        fs.appendFileSync(mainLogPath, `Exit code: ${result.status}\n`);

        if (result.status !== 0) throw new Error(`Command failed: ${cmd}`);
        return commandLogPath;
    }

    streamCommand(cmd, cwd, env, onChunk) {
        return new Promise((resolve, reject) => {
            const parts = cmd.split(" ");
            const child = spawn(parts[0], parts.slice(1), { cwd, env, shell: true });
            const { StringDecoder } = require("string_decoder");
            const decoder = new StringDecoder("utf8");
            let buffer = "";
            const push = d => onChunk(d);
            const handle = chunk => {
                buffer += decoder.write(chunk);
                let nl;
                while ((nl = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.slice(0, nl + 1);
                    buffer = buffer.slice(nl + 1);
                    push(line);
                }
            };
            child.stdout.on("data", handle);
            child.stderr.on("data", handle);
            child.on("error", reject);
            child.on("close", code => {
                if (buffer) push(buffer);
                code === 0 ? resolve() : reject(new Error(`Command failed: ${cmd}`));
            });
        });
    }

    async ensureEcrRepo(repoName) {
        try {
            await this.ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
        } catch {
            await this.ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
        }
    }

    async dockerBuildPush({ projectName, workspaceRoot, logStream: mainLogPath }) {
        const repoUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`;
        const auth = await this.ecr.send(new GetAuthorizationTokenCommand({}));
        const token = Buffer.from(auth.authorizationData[0].authorizationToken, "base64").toString();
        const [username, password] = token.split(":");
        this.runCommand(`docker login -u ${username} -p ${password} ${auth.authorizationData[0].proxyEndpoint}`, null, process.env, mainLogPath);
        this.runCommand(`docker build -t ${projectName} .`, workspaceRoot, process.env, mainLogPath);
        this.runCommand(`docker tag ${projectName}:latest ${repoUri}:latest`, null, process.env, mainLogPath);
        this.runCommand(`docker push ${repoUri}:latest`, null, process.env, mainLogPath);
        return `${repoUri}:latest`;
    }

    async registerTaskDef({ projectName, imageUri }) {
        const params = {
            family: projectName,
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            cpu: "256",
            memory: "512",
            executionRoleArn: process.env.ECS_EXECUTION_ROLE,
            containerDefinitions: [
                {
                    name: projectName,
                    image: imageUri,
                    portMappings: [{ containerPort: 3000, protocol: "tcp" }],
                    essential: true
                }
            ]
        };
        const result = await this.ecs.send(new RegisterTaskDefinitionCommand(params));
        return result.taskDefinition.taskDefinitionArn;
    }

    async ensureTargetGroup(projectName) {
        try {
            const resp = await this.elbv2.send(new DescribeTargetGroupsCommand({ Names: [projectName] }));
            return resp.TargetGroups[0].TargetGroupArn;
        } catch {
            const resp = await this.elbv2.send(new CreateTargetGroupCommand({
                Name: projectName,
                Protocol: "HTTP",
                Port: 3000,
                VpcId: process.env.VPC_ID,
                TargetType: "ip",
                HealthCheckProtocol: "HTTP",
                HealthCheckPath: "/",
                Matcher: { HttpCode: "200-399" }
            }));
            return resp.TargetGroups[0].TargetGroupArn;
        }
    }

    async createOrUpdateService({ projectName, taskDefArn, domainName, targetGroupArn }) {
        const cluster = process.env.ECS_CLUSTER;
        const serviceName = projectName;
        const listenerArn = process.env.ALB_LISTENER_ARN;
        let existing;
        try {
            const desc = await this.ecs.send(new DescribeServicesCommand({ cluster, services: [serviceName] }));
            existing = desc.services && desc.services[0] && desc.services[0].status !== "INACTIVE";
        } catch {
            existing = false;
        }
        if (!existing) {
            await this.ecs.send(new CreateServiceCommand({
                cluster,
                serviceName,
                taskDefinition: taskDefArn,
                desiredCount: 1,
                launchType: "FARGATE",
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: process.env.SUBNETS.split(","),
                        securityGroups: process.env.SECURITY_GROUPS.split(","),
                        assignPublicIp: "ENABLED"
                    }
                },
                loadBalancers: [
                    {
                        targetGroupArn,
                        containerName: projectName,
                        containerPort: 3000
                    }
                ]
            }));
        } else {
            await this.ecs.send(new UpdateServiceCommand({ cluster, service: serviceName, taskDefinition: taskDefArn }));
        }
        const rules = await this.elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
        const hostRule = rules.Rules.find(r =>
            r.Conditions &&
            r.Conditions.some(c =>
                c.Field === "host-header" &&
                c.HostHeaderConfig.Values.includes(`${domainName}.stackforgeengine.com`)
            )
        );
        if (!hostRule) {
            await this.elbv2.send(new CreateRuleCommand({
                ListenerArn: listenerArn,
                Priority: parseInt(process.env.RULE_PRIORITY, 10),
                Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [`${domainName}.stackforgeengine.com`] } }],
                Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
            }));
        } else {
            await this.elbv2.send(new ModifyRuleCommand({
                RuleArn: hostRule.RuleArn,
                Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [`${domainName}.stackforgeengine.com`] } }]
            }));
        }
    }

    async launchContainer({ userID, organizationID, projectName, domainName, repository, branch, teamName, rootDirectory, installCommand, buildCommand, envVars }) {
        const workspaceRoot = path.join(process.env.DEPLOY_WORKSPACE || "/tmp", `${projectName}-${uuidv4()}`);
        fs.mkdirSync(workspaceRoot, { recursive: true });
        const logPath = path.join(workspaceRoot, "deploy.log");
        fs.writeFileSync(logPath, ""); // Initialize empty file

        let repoUrl = repository;
        if (!/^https?:\/\//i.test(repository) && !/^git@/i.test(repository)) {
            repoUrl = `https://github.com/${repository}.git`;
        }
        this.runCommand(`git clone --depth 1 -b ${branch} ${repoUrl} ${workspaceRoot}`, null, process.env, logPath);
        const projectRoot = path.join(workspaceRoot, rootDirectory || "");
        const installCmd = installCommand || "npm install";
        const [installName] = installCmd.split(" ");
        if (!this.commandExists(installName)) this.runCommand(`npm install -g ${installName}`, null, process.env, logPath);
        if (!fs.existsSync(path.join(projectRoot, "node_modules"))) this.runCommand(installCmd, projectRoot, { ...process.env, ...envVars }, logPath);
        const buildCmd = buildCommand || "npm run build";
        const [buildName] = buildCmd.split(" ");
        if (!this.commandExists(buildName)) this.runCommand(`npm install -g ${buildName}`, null, process.env, logPath);
        this.runCommand(buildCmd, projectRoot, { ...process.env, ...envVars }, logPath);
        await this.ensureEcrRepo(projectName);
        const imageUri = await this.dockerBuildPush({ projectName, workspaceRoot, logStream: logPath });
        const taskDefArn = await this.registerTaskDef({ projectName, imageUri });
        const targetGroupArn = await this.ensureTargetGroup(projectName);
        await this.createOrUpdateService({ projectName, taskDefArn, domainName, targetGroupArn });
        return logPath;
    }

    async cloneAndBuild({ repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName }) {
        const workspaceRoot = path.join(process.env.DEPLOY_WORKSPACE || "/tmp", `${projectName}-${uuidv4()}`);
        fs.mkdirSync(workspaceRoot, { recursive: true });
        const logPath = path.join(workspaceRoot, "build.log");
        fs.writeFileSync(logPath, ""); // Initialize empty file

        let repoUrl = repository;
        if (!/^https?:\/\//i.test(repository) && !/^git@/i.test(repository)) {
            if (process.env.GITHUB_CLONE_TOKEN) {
                repoUrl = `https://${process.env.GITHUB_CLONE_TOKEN}@github.com/${repository}.git`;
            } else {
                repoUrl = `https://github.com/${repository}.git`;
            }
        }
        try {
            this.runCommand(`git clone --depth 1 -b ${branch} ${repoUrl} ${workspaceRoot}`, null, process.env, logPath);
            const projectRoot = path.join(workspaceRoot, rootDirectory || "");
            const installCmd = installCommand || "npm install";
            const [installName] = installCmd.split(" ");
            if (!this.commandExists(installName)) this.runCommand(`npm install -g ${installName}`, null, process.env, logPath);
            if (!fs.existsSync(path.join(projectRoot, "node_modules"))) this.runCommand(installCmd, projectRoot, { ...process.env, ...envVars }, logPath);
            const buildCmd = buildCommand || "npm run build";
            const [buildName] = buildCmd.split(" ");
            if (!this.commandExists(buildName)) this.runCommand(`npm install -g ${buildName}`, null, process.env, logPath);
            this.runCommand(buildCmd, projectRoot, { ...process.env, ...envVars }, logPath);
            spawn("npx", ["serve", "-s", path.join(projectRoot, outputDirectory || "build"), "-l", "3000"], { detached: true, stdio: "ignore" }).unref();
            return logPath;
        } catch (err) {
            err.logPath = logPath;
            throw err;
        }
    }

    async cloneAndBuildStream({ repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName }, onData) {
        const workspaceRoot = path.join(process.env.DEPLOY_WORKSPACE || "/tmp", `${projectName}-${uuidv4()}`);
        const logDir = path.join(workspaceRoot, "logs"); 
        const repoDir = path.join(workspaceRoot, "repo"); 
        onData(`Process ID: ${process.pid}, Setting up workspace directory: ${workspaceRoot}\n`);
        try {
            if (fs.existsSync(workspaceRoot)) {
                onData(`Cleaning up existing directory: ${workspaceRoot}\n`);
                fs.rmSync(workspaceRoot, { recursive: true, force: true }); 
                onData(`Cleaned up directory: ${workspaceRoot}\n`);
            } else {
                onData(`No existing directory found: ${workspaceRoot}\n`);
            }

            fs.mkdirSync(workspaceRoot, { recursive: true });
            onData(`Created new directory: ${workspaceRoot}\n`);

            fs.mkdirSync(logDir, { recursive: true });
            onData(`Created log directory: ${logDir}\n`);

            let dirContents = fs.readdirSync(workspaceRoot);
            if (dirContents.length > 1 || (dirContents.length === 1 && dirContents[0] !== "logs")) {
                onData(`Error: Directory ${workspaceRoot} is not empty after creation. Contents: ${dirContents.join(", ")}\n`);
                throw new Error(`Directory ${workspaceRoot} is not empty: ${dirContents.join(", ")}`);
            } else {
                onData(`Verified directory contains only log directory: ${workspaceRoot}\n`);
            }
        } catch (err) {
            onData(`Failed to set up directory: ${err.message}\n`);
            throw new Error(`Directory setup failed: ${err.message}`);
        }

        let repoUrl = repository;
        if (!/^https?:\/\//i.test(repository) && !/^git@/i.test(repository)) {
            if (process.env.GITHUB_CLONE_TOKEN) {
                repoUrl = `https://${process.env.GITHUB_CLONE_TOKEN}@github.com/${repository}.git`;
            } else {
                repoUrl = `https://github.com/${repository}.git`;
            }
        }

        const executeWithSummary = async (cmd, cwd, env, summary) => {
            onData(`Starting: ${summary}\n`);
            const logPath = path.join(logDir, `cmd-${uuidv4()}.log`);
            fs.writeFileSync(logPath, ""); 
            const parts = cmd.split(" ");
            const child = spawn(parts[0], parts.slice(1), { cwd, env });

            let output = "";
            child.stdout.on("data", (data) => {
                output += data.toString();
                fs.appendFileSync(logPath, data.toString());
            });
            child.stderr.on("data", (data) => {
                output += data.toString();
                fs.appendFileSync(logPath, data.toString());
            });

            return new Promise((resolve, reject) => {
                child.on("error", (err) => {
                    fs.appendFileSync(logPath, err.message);
                    onData(`Failed: ${summary}\nError Details: ${err.message}\n`);
                    reject(new Error(`Command failed: ${cmd}\n${err.message}`));
                });
                child.on("close", (code) => {
                    if (code === 0) {
                        onData(`Completed: ${summary}\n`);
                        resolve();
                    } else {
                        onData(`Failed: ${summary}\nError Details: ${output}\n`);
                        reject(new Error(`Command failed: ${cmd}\n${output}`));
                    }
                });
            });
        };

        try {
            fs.mkdirSync(repoDir, { recursive: true });
            onData(`Created repo directory: ${repoDir}\n`);

            let repoDirContents = fs.readdirSync(repoDir);
            if (repoDirContents.length > 0) {
                onData(`Error: Repo directory ${repoDir} is not empty before clone. Contents: ${repoDirContents.join(", ")}\n`);
                throw new Error(`Repo directory ${repoDir} is not empty: ${repoDirContents.join(", ")}`);
            } else {
                onData(`Confirmed repo directory is empty before clone: ${repoDir}\n`);
            }

            await executeWithSummary(
                `git clone --depth 1 -b ${branch} ${repoUrl} ${repoDir}`,
                null,
                process.env,
                `Cloning repository ${repository} (branch: ${branch})`
            );

            const projectRoot = path.join(repoDir, rootDirectory || "");
            const installCmd = installCommand || "npm install";
            const [installName] = installCmd.split(" ");

            if (!this.commandExists(installName)) {
                await executeWithSummary(
                    `npm install -g ${installName}`,
                    null,
                    process.env,
                    `Installing global ${installName} command`
                );
            }

            if (!fs.existsSync(path.join(projectRoot, "node_modules"))) {
                await executeWithSummary(
                    installCmd,
                    projectRoot,
                    { ...process.env, ...envVars },
                    `Installing project dependencies with ${installCmd}`
                );
            } else {
                onData("Skipping dependency installation: node_modules already exists\n");
            }

            const buildCmd = buildCommand || "npm run build";
            const [buildName] = buildCmd.split(" ");

            if (!this.commandExists(buildName)) {
                await executeWithSummary(
                    `npm install -g ${buildName}`,
                    null,
                    process.env,
                    `Installing global ${buildName} command`
                );
            }

            await executeWithSummary(
                buildCmd,
                projectRoot,
                { ...process.env, ...envVars },
                `Building project with ${buildCmd}`
            );

            onData("Starting local server for built artifacts\n");
            spawn("npx", ["serve", "-s", path.join(projectRoot, outputDirectory || "build"), "-l", "3000"], {
                detached: true,
                stdio: "ignore"
            }).unref();
            onData("Local server started successfully\n");
        } catch (err) {
            try {
                const dirContentsOnError = fs.readdirSync(workspaceRoot);
                onData(`Workspace directory contents after error: ${dirContentsOnError.join(", ") || "empty"}\n`);
                const repoDirContentsOnError = fs.readdirSync(repoDir);
                onData(`Repo directory contents after error: ${repoDirContentsOnError.join(", ") || "empty"}\n`);
            } catch (e) {
                onData(`Failed to read directory contents after error: ${e.message}\n`);
            }
            onData(`Error during build process: ${err.message}\n`);
            throw err;
        }
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
            logPath = await this.launchContainer({ userID, organizationID, projectName, domainName, repository, branch, teamName, rootDirectory, installCommand, buildCommand, envVars });
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
            error.logPath = logPath;
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
        const albZoneId = process.env.LOAD_BALANCER_ZONE_ID;
        const loadBalancerDNS = process.env.LOAD_BALANCER_DNS;
        if (!hostedZoneId || !albZoneId || !loadBalancerDNS) throw new Error("Route53 DNS configuration missing.");
        const recordName = `${subdomain}.stackforgeengine.com`;
        let changes = [];
        try {
            const listResp = await route53Client.send(new ListResourceRecordSetsCommand({
                HostedZoneId: hostedZoneId,
                StartRecordName: recordName,
                StartRecordType: "CNAME",
                MaxItems: "1"
            }));
            const existing = listResp.ResourceRecordSets && listResp.ResourceRecordSets[0];
            if (existing && existing.Name.replace(/\.$/, "") === recordName) {
                changes.push({
                    Action: "DELETE",
                    ResourceRecordSet: existing
                });
            }
        } catch { }
        changes.push({
            Action: "UPSERT",
            ResourceRecordSet: {
                Name: recordName,
                Type: "A",
                AliasTarget: {
                    HostedZoneId: albZoneId,
                    DNSName: loadBalancerDNS,
                    EvaluateTargetHealth: false
                }
            }
        });
        const params = {
            HostedZoneId: hostedZoneId,
            ChangeBatch: { Changes: changes }
        };
        await route53Client.send(new ChangeResourceRecordSetsCommand(params));
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
          d.username,
          d.status,
          d.url,
          d.template,
          d.created_at,
          d.updated_at,
          d.last_deployed_at
        FROM deployments d
        WHERE d.orgid = $1
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
        const { userID, organizationID, repository, branch, teamName, projectName, rootDirectory, outputDirectory, buildCommand, installCommand } = req.query;
        let envVars = [];
        try { envVars = JSON.parse(req.query.envVars || "[]"); } catch { envVars = []; }
        const domainName = projectName.toLowerCase().replace(/\s+/g, "-");
        function sendLine(chunk) {
            let safe = chunk.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
            while (safe.length > 3500) {
                res.write(`data: ${safe.slice(0, 3500)}\n\n`);
                safe = safe.slice(3500);
            }
            res.write(`data: ${safe}\n\n`);
            if (res.flush) res.flush();
        }

        try {
            await deployManager.launchWebsiteStream(
                { userID, organizationID, projectName, domainName, template: "default", repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars },
                sendLine
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
        const projectResult = await pool.query("SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3", [projectID, organizationID, userID]);
        if (projectResult.rows.length === 0) return res.status(404).json({ message: "Project not found or access denied." });
        const project = projectResult.rows[0];
        const domainsResult = await pool.query("SELECT * FROM domains WHERE project_id = $1 AND orgid = $2", [projectID, organizationID]);
        const deploymentsResult = await pool.query("SELECT * FROM deployments WHERE project_id = $1 AND orgid = $2", [projectID, organizationID]);
        return res.status(200).json({ project, domains: domainsResult.rows, deployments: deploymentsResult.rows });
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error connecting to the database. Please try again later." });
        next(error);
    }
});

router.post("/snapshot", authenticateToken, async (req, res, next) => {
    const { projectID, organizationID, userID } = req.body;
    try {
        const projectResult = await pool.query("SELECT url FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3", [projectID, organizationID, userID]);
        if (projectResult.rows.length === 0) return res.status(404).json({ message: "Project not found or access denied." });
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
        if (result.rows.length === 0 || !result.rows[0].github_access_token) return res.status(400).json({ message: "GitHub account not connected." });
        const githubAccessToken = result.rows[0].github_access_token;
        let repoName = repo;
        let repoOwner = owner;
        if (repo.includes("/")) {
            let parts = repo.split("/");
            repoOwner = parts[0];
            repoName = parts[1];
        }
        const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits`;
        const gitResponse = await axios.get(url, { headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" } });
        return res.status(200).json(gitResponse.data);
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error fetching git commits." });
        next(error);
    }
});

router.post("/git-commit-details", authenticateToken, async (req, res, next) => {
    const { userID, owner, repo, commitSha } = req.body;
    try {
        if (!owner || !repo || !commitSha) return res.status(400).json({ message: "Owner, repository, and commitSha are required." });
        const result = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (result.rows.length === 0 || !result.rows[0].github_access_token) return res.status(400).json({ message: "GitHub account not connected." });
        const githubAccessToken = result.rows[0].github_access_token;
        let repoName = repo;
        let repoOwner = owner;
        if (repo.includes("/")) {
            let parts = repo.split("/");
            repoOwner = parts[0];
            repoName = parts[1];
        }
        const url = `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${commitSha}`;
        const gitResponse = await axios.get(url, { headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" } });
        return res.status(200).json(gitResponse.data);
    } catch (error) {
        if (!res.headersSent) return res.status(400).json({ message: "Error fetching commit details." });
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
            if (!contentLength && websiteResponse.data) contentLength = websiteResponse.data.toString().length;
            websiteAnalytics = { status: websiteResponse.status, responseTime, contentLength };
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
            if (result.rows.length === 0 || !result.rows[0].github_access_token) return res.status(400).json({ message: "GitHub account not connected." });
            const githubAccessToken = result.rows[0].github_access_token;
            const repoResponse = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
                headers: { Authorization: `token ${githubAccessToken}`, Accept: "application/vnd.github.v3+json" }
            });
            repositoryAnalytics = repoResponse.data;
        }
        return res.status(200).json({ websiteAnalytics, repositoryAnalytics });
    } catch (error) {
        if (!res.headersSent) return res.status(500).json({ message: "Error fetching analytics.", error: error.message });
        next(error);
    }
});

module.exports = router;