
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { pool } = require("../../config/db");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const {
    Route53Client,
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand,
} = require("@aws-sdk/client-route-53");
const {
    ECRClient,
    DescribeRepositoriesCommand,
    CreateRepositoryCommand,
    DeleteRepositoryCommand
} = require("@aws-sdk/client-ecr");
const {
    ECSClient,
    RegisterTaskDefinitionCommand,
    DescribeTaskDefinitionCommand,
    DescribeServicesCommand,
    CreateServiceCommand,
    UpdateServiceCommand,
    DeleteServiceCommand,
    waitUntilServicesStable,
    ListTasksCommand,
    ListTaskDefinitionsCommand,
    DeregisterTaskDefinitionCommand
} = require("@aws-sdk/client-ecs");
const {
    ElasticLoadBalancingV2Client,
    DescribeRulesCommand,
    CreateRuleCommand,
    ModifyRuleCommand,
    DescribeTargetGroupsCommand,
    CreateTargetGroupCommand,
    DescribeLoadBalancersCommand,
    DescribeListenersCommand,
    DescribeTargetHealthCommand,
    DeleteRuleCommand,
    DescribeListenerCertificatesCommand,
    DeleteTargetGroupCommand
} = require("@aws-sdk/client-elastic-load-balancing-v2");
const {
    CodeBuildClient,
    StartBuildCommand,
    BatchGetBuildsCommand,
    CreateProjectCommand,
    UpdateProjectCommand,
    DeleteProjectCommand,
    ListProjectsCommand
} = require("@aws-sdk/client-codebuild");
const {
    S3Client,
    PutObjectCommand
} = require("@aws-sdk/client-s3");
const {
    CloudWatchLogsClient,
    GetLogEventsCommand,
    CreateLogStreamCommand,
    CreateLogGroupCommand,
    DescribeLogGroupsCommand,
    DeleteLogGroupCommand
} = require("@aws-sdk/client-cloudwatch-logs");
const {
    ACMClient,
    RequestCertificateCommand,
    DescribeCertificateCommand,
    DeleteCertificateCommand
} = require("@aws-sdk/client-acm");
const {
    CloudFrontClient,
    CreateInvalidationCommand,
    ListDistributionsCommand
} = require('@aws-sdk/client-cloudfront');

const codeBuildClient = new CodeBuildClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });
const cloudWatchLogsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

class DeployManager {
    constructor() {
        this.ecr = new ECRClient({ region: process.env.AWS_REGION });
        this.ecs = new ECSClient({ region: process.env.AWS_REGION });
        this.elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
    }

    async validateGitHubToken(githubAccessToken, repository) {
        try {
            const userResponse = await axios.get("https://api.github.com/user", {
                headers: {
                    Authorization: `token ${githubAccessToken}`,
                    Accept: "application/vnd.github.v3+json"
                }
            });
            const repoPath = repository.includes("/") ? repository : `piacobelli14/${repository}`;
            const [owner, repo] = repoPath.split("/");
            const repoResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: {
                    Authorization: `token ${githubAccessToken}`,
                    Accept: "application/vnd.github.v3+json"
                }
            });
            const scopes = repoResponse.headers["x-oauth-scopes"]?.split(", ") || [];
            if (!scopes.includes("repo")) {
                throw new Error("GitHub token missing 'repo' scope required for private repository access.");
            }
            return true;
        } catch (error) {
            throw new Error(`Invalid GitHub token or repository access: ${error.message}.`);
        }
    }

    async ensureECRRepo(repoName) {
        try {
            await this.ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
        } catch {
            await this.ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
        }
    }

    async ensureTargetGroup(projectName, subdomain) {
        if (!projectName || typeof projectName !== "string" || !projectName.trim()) {
            throw new Error(`Invalid projectName: ${projectName}.`);
        }

        const p0 = projectName.toLowerCase();
        let s0 = subdomain ? subdomain.toLowerCase() : null;
        if (s0 === p0) s0 = null;                       

        const baseName = s0 ? `${p0}-${s0.replace(/\./g, "-")}`.slice(0, 26)
            : p0.slice(0, 26);

        const vpcId = process.env.VPC_ID;
        const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
        if (!vpcId || !listenerArn) {
            throw new Error("VPC_ID or ALB_LISTENER_ARN_HTTPS missing in env.");
        }

        const desired = {
            Protocol: "HTTP",
            Port: 80,
            VpcId: vpcId,
            TargetType: "ip",
            HealthCheckProtocol: "HTTP",
            HealthCheckPort: "traffic-port",
            HealthCheckPath: "/",
            HealthCheckIntervalSeconds: 30,
            HealthCheckTimeoutSeconds: 5,
            HealthyThresholdCount: 5,
            UnhealthyThresholdCount: 2
        };

        const hostHeader = s0
            ? `${s0}.stackforgeengine.com`
            : `${p0}.stackforgeengine.com`;

        const isCompatible = (tg) =>
            tg.Protocol === desired.Protocol &&
            tg.Port === desired.Port &&
            tg.VpcId === desired.VpcId &&
            tg.TargetType === desired.TargetType &&
            tg.HealthCheckProtocol === desired.HealthCheckProtocol &&
            tg.HealthCheckPort === desired.HealthCheckPort &&
            tg.HealthCheckPath === desired.HealthCheckPath &&
            tg.HealthCheckIntervalSeconds === desired.HealthCheckIntervalSeconds &&
            tg.HealthCheckTimeoutSeconds === desired.HealthCheckTimeoutSeconds &&
            tg.HealthyThresholdCount === desired.HealthyThresholdCount &&
            tg.UnhealthyThresholdCount === desired.UnhealthyThresholdCount;

        let tgName = baseName;
        let tgArn = undefined;
        let version = 0;              

        while (true) {
            let existingTg;
            try {
                const d = await this.elbv2.send(
                    new DescribeTargetGroupsCommand({ Names: [tgName] })
                );
                existingTg = d.TargetGroups?.[0];
            } catch (error) {
                if (error.name !== "TargetGroupNotFoundException") throw error;
            }

            if (existingTg && isCompatible(existingTg)) {
                tgArn = existingTg.TargetGroupArn;
                break;
            }

            if (existingTg) {
                tgArn = existingTg.TargetGroupArn;
                try {
                    const { Rules } = await this.elbv2.send(
                        new DescribeRulesCommand({ ListenerArn: listenerArn })
                    );
                    for (const r of Rules ?? []) {
                        if (!r.IsDefault &&
                            r.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === tgArn)) {
                            await this.elbv2.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
                        }
                    }
                    await this.elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn }));
                    tgArn = undefined;                  
                } catch (error) {
                    if (error.name === "ResourceInUseException") {
                        version += 1;
                        tgName = `${baseName}-v${version + 1}`.slice(0, 32);
                        tgArn = undefined;
                    } else {
                        throw error;
                    }
                }
            }

            if (!tgArn) {
                const c = await this.elbv2.send(
                    new CreateTargetGroupCommand({ Name: tgName, ...desired })
                );
                tgArn = c.TargetGroups[0].TargetGroupArn;
                break;
            }
        } 

        const { Rules } = await this.elbv2.send(
            new DescribeRulesCommand({ ListenerArn: listenerArn })
        );
        const already = Rules?.find(r =>
            !r.IsDefault &&
            r.Conditions.some(
                c => c.Field === "host-header" && c.Values.includes(hostHeader)
            )
        );

        if (!already) {
            const used = new Set(
                Rules.filter(r => !r.IsDefault).map(r => Number(r.Priority))
            );
            let priority = 10000;          
            while (used.has(priority)) priority += 1;

            await this.elbv2.send(
                new CreateRuleCommand({
                    ListenerArn: listenerArn,
                    Priority: priority,
                    Conditions: [{ Field: "host-header", Values: [hostHeader] }],
                    Actions: [{ Type: "forward", TargetGroupArn: tgArn }]
                })
            );
        } 
        
        return tgArn;
    }

    async ensureLogGroup(logGroupName) {
        const listResp = await cloudWatchLogsClient.send(new DescribeLogGroupsCommand({
            logGroupNamePrefix: logGroupName
        }));
        const exists = (listResp.logGroups || []).some(g => g.logGroupName === logGroupName);

        if (!exists) {
            await cloudWatchLogsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } 
    }

    async getDeploymentStatus(deploymentId, organizationID, userID) {
        const deploymentResult = await pool.query(
            `SELECT 
             d.*,
             p.name AS project_name,
             dm.domain_name AS domain,
             o.orgname 
             FROM deployments d
             LEFT JOIN projects p ON d.project_id = p.project_id
             LEFT JOIN domains dm ON d.domain_id = dm.domain_id
             JOIN organizations o ON d.orgid = o.orgid
             WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3`,
            [deploymentId, organizationID, userID]
        );
        if (deploymentResult.rows.length === 0) {
            throw new Error("Deployment not found or access denied.");
        }
        return deploymentResult.rows[0];
    }

    async getAvailableRulePriority(listenerArn) {
        const usedPriorities = new Set();
        const { Rules } = await this.elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
        Rules.filter(r => !r.IsDefault).forEach(r => usedPriorities.add(parseInt(r.Priority)));

        for (let p = 1; p <= 50000; p++) {
            if (!usedPriorities.has(p)) {
                return p;
            }
        }
        throw new Error("No free ALB priority available.");
    }

    async getLatestCommitSha(repository, branch, githubAccessToken) {
        try {
            const repoPath = repository.includes("/") ? repository : `piacobelli14/${repository}`;
            const [owner, repo] = repoPath.split("/");
            const response = await axios.get(
                `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
                {
                    headers: {
                        Authorization: `token ${githubAccessToken}`,
                        Accept: "application/vnd.github.v3+json",
                    },
                }
            );
            return response.data.sha;
        } catch (error) {
            throw new Error(`Failed to fetch latest commit SHA: ${error.message}.`);
        }
    }

    async getTaskDefinitionARN(projectName, deploymentID) {
        try {
            const deploymentResult = await pool.query(
                `SELECT task_def_arn 
                 FROM deployments 
                 WHERE deployment_id = $1`,
                [deploymentID]
            );
            if (deploymentResult.rows.length === 0) {
                throw new Error(`Deployment ${deploymentID} not found.`);
            }
            const taskDefArn = deploymentResult.rows[0].task_def_arn;
            if (!taskDefArn) {
                return `arn:aws:ecs:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:task-definition/${projectName}:1`;
            }
            return taskDefArn;
        } catch (error) {
            throw new Error(`Failed to retrieve task definition ARN: ${error.message}.`);
        }
    }

    async listDeployments(organizationID) {
        const deploymentListResult = await pool.query(
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
             ORDER BY d.created_at DESC`,
            [organizationID]
        );
        return deploymentListResult.rows;
    }

    async listProjects(organizationID) {
        const projectListResult = await pool.query(
            `SELECT * FROM projects
             WHERE orgid = $1
             ORDER BY created_at DESC`,
            [organizationID]
        );
        return projectListResult.rows;
    }

    async listDomains(organizationID) {
        const domainListResult = await pool.query(
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
             ORDER BY created_at DESC`,
            [organizationID]
        );
        return domainListResult.rows;
    }

    async createTaskDef({ projectName, subdomain, imageUri, envVars }) {
        const taskFamily = subdomain
            ? `${projectName}-${subdomain.replace(/\./g, '-')}`
            : projectName;
        const logGroupName = `/ecs/${taskFamily}`;

        try {
            await cloudWatchLogsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } catch (error) {
            if (error.name !== "ResourceAlreadyExistsException") {
                throw new Error(`Failed to create CloudWatch log group: ${error.message}.`);
            }
        }

        const containerEnvVars = Array.isArray(envVars)
            ? envVars
                .filter(envVar => envVar.key && envVar.key.trim() && envVar.value != null)
                .map(envVar => ({
                    name: envVar.key.trim(),
                    value: envVar.value.toString()
                }))
            : [];

        const params = {
            family: taskFamily,
            networkMode: "awsvpc",
            requiresCompatibilities: ["FARGATE"],
            cpu: "256",
            memory: "512",
            executionRoleArn: process.env.ECS_EXECUTION_ROLE,
            containerDefinitions: [
                {
                    name: taskFamily,
                    image: imageUri,
                    portMappings: [{ containerPort: 3000, protocol: "tcp" }],
                    essential: true,
                    environment: containerEnvVars,
                    logConfiguration: {
                        logDriver: "awslogs",
                        options: {
                            "awslogs-group": logGroupName,
                            "awslogs-region": process.env.AWS_REGION,
                            "awslogs-stream-prefix": "ecs"
                        }
                    }
                }
            ]
        };
        try {
            const result = await this.ecs.send(new RegisterTaskDefinitionCommand(params));
            return result.taskDefinition.taskDefinitionArn;
        } catch (error) {
            if (error.name === "AccessDeniedException") {
                throw new Error(`IAM permissions error: ${error.message}. Ensure your IAM user or role has 'iam:PassRole' permission on the role ${process.env.ECS_EXECUTION_ROLE}.`);
            }
            throw error;
        }
    }

    async createOrUpdateService({
        projectName,
        subdomain,
        taskDefArn,
        targetGroupArn,
        healthCheckPath = "/"
    }) {
        const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
        const elbClient = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const cfClient = new CloudFrontClient({ region: process.env.AWS_REGION });

        ["ECS_CLUSTER_ARN", "ECS_CLUSTER", "SUBNET_IDS",
            "SECURITY_GROUP_IDS", "ALB_LISTENER_ARN_HTTPS", "AWS_REGION"]
            .forEach(k => { if (!process.env[k]) throw new Error(`Missing env ${k}.`); });

        const serviceName = subdomain ? `${projectName}-${subdomain.replace(/\./g, "-")}` : projectName;
        const containerName = subdomain ? `${projectName}-${subdomain.replace(/\./g, "-")}` : projectName;
        const fqdn = subdomain ? `${subdomain}.stackforgeengine.com`
            : `${projectName}.stackforgeengine.com`;

        const ruleExists = async (listenerArn, targetGroupArn) => {
            const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
            const rule = Rules.find(r =>
                !r.IsDefault &&
                r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn)) &&
                r.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === targetGroupArn)
            );
            return rule ? rule.RuleArn : null;
        };
        const pickPriority = async (listenerArn) => {
            const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
            const used = new Set(Rules.filter(r => !r.IsDefault).map(r => parseInt(r.Priority, 10)));
            for (let p = 1; p <= 50000; p++) if (!used.has(p)) return p;
            throw new Error("No free ALB priority.");
        };
        const existingRuleArn = await ruleExists(process.env.ALB_LISTENER_ARN_HTTPS, targetGroupArn);
        if (existingRuleArn) {
            await elbClient.send(new ModifyRuleCommand({
                RuleArn: existingRuleArn,
                Conditions: [{ Field: "host-header", Values: [fqdn] }],
                Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
            }));
        } else {
            const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS }));
            const outdatedRule = Rules.find(r =>
                !r.IsDefault &&
                r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn))
            );
            if (outdatedRule) {
                await elbClient.send(new DeleteRuleCommand({ RuleArn: outdatedRule.RuleArn }));
            }
            await elbClient.send(new CreateRuleCommand({
                ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                Priority: await pickPriority(process.env.ALB_LISTENER_ARN_HTTPS),
                Conditions: [{ Field: "host-header", Values: [fqdn] }],
                Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
            }));
        }

        const td = await ecsClient.send(
            new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn })
        );
        let cont = td.taskDefinition.containerDefinitions.find(c => c.name === containerName);
        if (!cont) {
            cont = td.taskDefinition.containerDefinitions[0];
            if (!cont) throw new Error(`No containers found in task definition ${taskDefArn}.`);
        }
        const port = cont.portMappings?.[0]?.containerPort || 3000;

        const svcBase = {
            cluster: process.env.ECS_CLUSTER_ARN,
            taskDefinition: taskDefArn,
            desiredCount: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: process.env.SUBNET_IDS.split(","),
                    securityGroups: process.env.SECURITY_GROUP_IDS.split(","),
                    assignPublicIp: "ENABLED"
                }
            },
            loadBalancers: [{
                targetGroupArn: targetGroupArn,
                containerName: cont.name,
                containerPort: port
            }],
            healthCheckGracePeriodSeconds: 60
        };

        const { services } = await ecsClient.send(new DescribeServicesCommand({
            cluster: process.env.ECS_CLUSTER_ARN,
            services: [serviceName]
        }));
        const existing = services?.[0];

        if (existing && existing.status === "ACTIVE") {
            await ecsClient.send(new UpdateServiceCommand({
                ...svcBase,
                service: serviceName,
                forceNewDeployment: true
            }));
            await waitUntilServicesStable(
                { client: ecsClient, maxWaitTime: 600, minDelay: 10, maxDelay: 30 },
                { cluster: process.env.ECS_CLUSTER_ARN, services: [serviceName] }
            );
        } else {
            if (existing) {
                await ecsClient.send(new DeleteServiceCommand({
                    cluster: process.env.ECS_CLUSTER_ARN, service: serviceName, force: true
                }));
            }
            await ecsClient.send(new CreateServiceCommand({
                ...svcBase, serviceName, launchType: "FARGATE"
            }));
            await waitUntilServicesStable(
                { client: ecsClient, maxWaitTime: 600, minDelay: 10, maxDelay: 30 },
                { cluster: process.env.ECS_CLUSTER_ARN, services: [serviceName] }
            );
        }

        const serviceDesc = await ecsClient.send(
            new DescribeServicesCommand({
                cluster: process.env.ECS_CLUSTER_ARN,
                services: [serviceName]
            })
        );
        const service = serviceDesc.services?.[0];
        if (!service || service.status !== 'ACTIVE' || service.runningCount < 1) {
            throw new Error(`Service ${serviceName} is not healthy: status=${service?.status}, runningCount=${service?.runningCount}.`);
        }
        const targetHealth = await elbClient.send(
            new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn })
        );
        if (!targetHealth.TargetHealthDescriptions.some(t => t.TargetHealth.State === 'healthy')) {
            throw new Error(`No healthy targets in target group ${targetGroupArn}.`);
        }

        if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
            await cfClient.send(new CreateInvalidationCommand({
                DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                InvalidationBatch: {
                    CallerReference: `ecs-${serviceName}-${Date.now()}`,
                    Paths: { Quantity: 2, Items: ["/", "/*"] }
                }
            }));
        }
    }

    async createCodeBuildProject({
        projectName,
        subdomain,
        repository,
        branch,
        rootDirectory,
        installCommand,
        buildCommand,
        outputDirectory,
        githubAccessToken
    }) {
        if (!repository || typeof repository !== "string" || !repository.trim()) {
            throw new Error("Invalid repository: must be a non‑empty string.");
        }
        if (!githubAccessToken || typeof githubAccessToken !== "string" || !githubAccessToken.trim()) {
            throw new Error("Invalid GitHub access token.");
        }
        await this.validateGitHubToken(githubAccessToken, repository);

        let repoUrl;
        if (/^https?:\/\//i.test(repository) || /^git@/i.test(repository)) {
            repoUrl = repository;
        } else {
            const clean = repository.trim().replace(/^\/+|\/+$/g, "");
            repoUrl = `https://github.com/${clean}.git`;
        }

        const rootDir = rootDirectory || ".";
        const imageTag = subdomain
            ? `${subdomain.replace(/\./g, "-")}-${await this.getLatestCommitSha(repository, branch, githubAccessToken)}`
            : "latest";

        const buildspec = {
            version: "0.2",
            phases: {
                install: {
                    "runtime-versions": { nodejs: "20" },
                    commands: [
                        'echo "Install phase: nothing to do here"'
                    ]
                },
                pre_build: {
                    commands: [
                        'echo "Starting pre_build phase"',
                        'echo "Configuring Git credentials"',
                        'git config --global credential.helper \'!f() { echo username=x-oauth-basic; echo password=$GITHUB_TOKEN; }; f\'',
                        'echo "Cloning repository into $CODEBUILD_SRC_DIR"',
                        'git clone --branch $REPO_BRANCH $REPO_URL $CODEBUILD_SRC_DIR || { echo "Git clone failed: $?"; exit 1; }',
                        'echo "Listing cloned files"', 'ls -la $CODEBUILD_SRC_DIR',
                        'echo "Entering root directory: $ROOT_DIRECTORY"', `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        'echo "Listing files in $ROOT_DIRECTORY"', `ls -la $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        'echo "Installing dependencies"', installCommand || "npm install"
                    ]
                },
                build: {
                    commands: [
                        'echo "Starting build phase"',
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        'echo "Current directory: $(pwd)"',
                        'echo "Listing files before build"', 'ls -la',
                        'echo "No build step required for Node.js app"'
                    ]
                },
                post_build: {
                    commands: [
                        'echo "Starting post_build phase"',
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        'echo "Current directory: $(pwd)"',
                        'echo "Listing files before Docker build"', 'ls -la',
                        'echo "Building Docker image"',
                        'echo "FROM node:20" > Dockerfile',
                        'echo "WORKDIR /app" >> Dockerfile',
                        'echo "COPY package*.json ./" >> Dockerfile',
                        'echo "RUN npm install" >> Dockerfile',
                        'echo "COPY api/ ./api/" >> Dockerfile',
                        'echo "CMD [\\"node\\", \\"api/index.js\\"]" >> Dockerfile',
                        'echo "Listing files in current directory after Dockerfile creation"', 'ls -la', 'cat Dockerfile',
                        '[ -n "$DOCKER_HUB_USERNAME" ] && [ -n "$DOCKER_HUB_PASSWORD" ] && ' +
                        'echo "$DOCKER_HUB_PASSWORD" | docker login --username "$DOCKER_HUB_USERNAME" --password-stdin || ' +
                        'echo "Skipping Docker‑Hub login (no creds)"',

                        'docker build -t $REPO_URI:$IMAGE_TAG .',
                        'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO_URI',
                        'docker push $REPO_URI:$IMAGE_TAG'
                    ]
                }
            },
            artifacts: { files: ["**/*"], "discard-paths": "yes" }
        };

        const envVars = [
            { name: "ROOT_DIRECTORY", value: rootDir, type: "PLAINTEXT" },
            { name: "INSTALL_COMMAND", value: installCommand || "npm install", type: "PLAINTEXT" },
            { name: "BUILD_COMMAND", value: buildCommand || "", type: "PLAINTEXT" },
            { name: "OUTPUT_DIRECTORY", value: outputDirectory || "", type: "PLAINTEXT" },
            { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
            { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
            { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
            { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
            { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" },
            { name: "IMAGE_TAG", value: imageTag, type: "PLAINTEXT" },
            { name: "DOCKER_HUB_USERNAME", value: process.env.DOCKER_HUB_USERNAME || "", type: "PLAINTEXT" },
            { name: "DOCKER_HUB_PASSWORD", value: process.env.DOCKER_HUB_PASSWORD || "", type: "PLAINTEXT" }
        ];

        const params = {
            name: subdomain ? `${projectName}-${subdomain.replace(/\./g, "-")}` : projectName,
            source: { type: "NO_SOURCE", buildspec: JSON.stringify(buildspec) },
            artifacts: { type: "NO_ARTIFACTS" },
            environment: {
                type: "LINUX_CONTAINER",
                image: "aws/codebuild/standard:7.0",
                computeType: "BUILD_GENERAL1_SMALL",
                environmentVariables: envVars,
                privilegedMode: true
            },
            serviceRole: process.env.CODEBUILD_ROLE_ARN,
            logsConfig: {
                cloudWatchLogs: {
                    status: "ENABLED",
                    groupName: `/aws/codebuild/${subdomain ? `${projectName}-${subdomain.replace(/\./g, "-")}` : projectName}`
                }
            }
        };

        try {
            await codeBuildClient.send(new CreateProjectCommand(params));
        } catch (error) {
            if (error.name === "ResourceAlreadyExistsException") {
                await codeBuildClient.send(new UpdateProjectCommand(params));
            } else {
                throw new Error(`Failed to create CodeBuild project: ${error.message}.`);
            }
        }

        if (subdomain) {
            await pool.query(
                `UPDATE domains
                SET image_tag = $1
                WHERE domain_name = $2
                AND project_id  = (SELECT project_id FROM projects WHERE name = $3)`,
                [imageTag, subdomain, projectName]
            );
        }
    }

    async startCodeBuild({
        projectName,
        subdomain,             
        repository,
        branch,
        logDir,
        githubAccessToken
    }) {
        const codeBuildProjectName = subdomain
            ? `${projectName}-${subdomain.replace(/\./g, '-')}`
            : projectName;

        const logGroupName = `/aws/codebuild/${codeBuildProjectName}`;
        const repoUrl = /^https?:\/\//i.test(repository) || /^git@/i.test(repository)
            ? repository
            : `https://github.com/${repository}.git`;

        if (!githubAccessToken) {
            throw new Error("GitHub access token is required for CodeBuild.");
        }
        await this.validateGitHubToken(githubAccessToken, repository);

        const imageTag = subdomain
            ? `${subdomain.replace(/\./g, '-')}-${await this.getLatestCommitSha(repository, branch, githubAccessToken)}`
            : "latest";

        try {
            await cloudWatchLogsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } catch (_) {}

        const startResp = await codeBuildClient.send(new StartBuildCommand({
            projectName: codeBuildProjectName,
            environmentVariablesOverride: [
                { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
                { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
                { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
                { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
                { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" },
                { name: "IMAGE_TAG", value: imageTag, type: "PLAINTEXT" }
            ]
        }));
        const buildId = startResp.build.id;

        let logStreamName = startResp.build.logs?.cloudWatchLogs?.logStreamName || null;
        if (!logStreamName) {
            for (let i = 0; i < 10 && !logStreamName; i++) {
                await new Promise(r => setTimeout(r, 3000)); 
                const info = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
                logStreamName = info.builds?.[0]?.logs?.cloudWatchLogs?.logStreamName || null;
            }
        }

        if (!logStreamName) logStreamName = buildId.split(":")[1];

        if (!logStreamName) {
            throw new Error("CodeBuild did not return a CloudWatch log‑stream name.");
        }

        const logFile = path.join(logDir, `codebuild-${buildId.replace(/:/g, "-")}.log`);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, "");               

        let nextToken;
        let buildStatus = "IN_PROGRESS";
        while (buildStatus === "IN_PROGRESS") {
            const logs = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                logGroupName,
                logStreamName,
                nextToken,
                startFromHead: true
            }));
            for (const event of logs.events) {
                fs.appendFileSync(logFile, event.message + "\n");
            }
            nextToken = logs.nextForwardToken;

            const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
            buildStatus = buildInfo.builds[0].buildStatus;

            await new Promise(r => setTimeout(r, 4000));   
        }

        if (buildStatus !== "SUCCEEDED") {
            const lastLine = fs.readFileSync(logFile, "utf-8").trim().split("\n").pop();
            throw new Error(`Build failed (status: ${buildStatus}) – ${lastLine || "no details"}.`);
        }

        const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:${imageTag}`;
        return { imageUri, logFile };
    }

    async streamCodeBuild(
        { projectName, subdomain = null, repository, branch, githubAccessToken },
        onChunk               
    ) {
        if (typeof onChunk !== "function") {
            throw new Error(`streamCodeBuild: onChunk must be a function, got ${typeof onChunk}.`);
        }
        if (!githubAccessToken) {
            onChunk("GitHub access token is required for CodeBuild\n");
            throw new Error("GitHub access token is required for CodeBuild.");
        }

        const codeBuildProjectName = subdomain
            ? `${projectName}-${subdomain.replace(/\./g, "-")}` 
            : projectName;                                      
        const logGroupName = `/aws/codebuild/${codeBuildProjectName}`;
        const repoUrl = /^https?:\/\//i.test(repository) || /^git@/i.test(repository)
            ? repository
            : `https://github.com/${repository}.git`;
        const imageTag = subdomain
            ? `${subdomain.replace(/\./g, "-")}-${await this.getLatestCommitSha(repository, branch, githubAccessToken)}`
            : "latest";

        const logStreamName = `build-${uuidv4()}`;           
        try {
            await cloudWatchLogsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } catch { }                                           
        try {
            await cloudWatchLogsClient.send(new CreateLogStreamCommand({ logGroupName, logStreamName }));
        } catch { }                                           

        let build;
        try {
            build = await codeBuildClient.send(new StartBuildCommand({
                projectName: codeBuildProjectName,
                environmentVariablesOverride: [
                    { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
                    { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
                    { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
                    { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
                    { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" },
                    { name: "IMAGE_TAG", value: imageTag, type: "PLAINTEXT" }
                ]
            }));
            onChunk(`CodeBuild started: id ${build.build.id}\n`);
        } catch (error) {
            onChunk(`Failed to start CodeBuild: ${error.message}\n`);
            throw error;
        }

        const buildId = build.build.id;
        const cbLogStreamName = build.build.logs?.cloudWatchLogs?.logStreamName   
            || buildId.split(":")[1];                           
        let nextToken = null;
        let buildStatus = "IN_PROGRESS";
        let lastLogEvent = "";
        const timeoutMs = 20 * 60 * 1000;  
        const t0 = Date.now();

        while (buildStatus === "IN_PROGRESS") {
            if (Date.now() - t0 > timeoutMs)
                throw new Error("Build timed‑out after 20 minutes.");

            try {
                const logs = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                    logGroupName,
                    logStreamName: cbLogStreamName,
                    nextToken,
                    startFromHead: true
                }));
                for (const ev of logs.events) {
                    onChunk(ev.message + "\n");
                    lastLogEvent = ev.message;
                }
                nextToken = logs.nextForwardToken;
            } catch (error) {
                if (error.name !== "ResourceNotFoundException") throw error;  
            }

            const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
            buildStatus = buildInfo.builds?.[0]?.buildStatus || "UNKNOWN";
            await new Promise(r => setTimeout(r, 3000));
        }

        if (buildStatus === "SUCCEEDED") {
            const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:${imageTag}`;
            onChunk(`Build OK → ${imageUri}\n`);
            return imageUri;
        }

        const info = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
        const phases = info.builds?.[0]?.phases || [];
        const failed = phases.reverse().find(p => p.phaseStatus === "FAILED");
        const reason = failed?.contexts?.map(c => c.message).join("; ")
            || failed?.phaseType
            || lastLogEvent
            || "no additional detail";
        throw new Error(`Build failed (status: ${buildStatus}) – ${reason}.`);
    }

    async cloneAndBuild({
        repository,
        branch,
        rootDirectory,
        outputDirectory,
        buildCommand,
        installCommand,
        envVars,
        projectName,
        deploymentId
    }) {
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        const tokenResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", ["piacobelli"]);
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, outputDirectory, githubAccessToken });
        const { logFile } = await this.startCodeBuild({ projectName, repository, branch, logDir, githubAccessToken });

        await pool.query(
            `UPDATE deployments 
             SET root_directory = $1, output_directory = $2, build_command = $3, install_command = $4, env_vars = $5
             WHERE deployment_id = $6`,
            [rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), deploymentId]
        );
        return logDir;
    }

    async cloneAndBuildStream(
        { repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName, deploymentId },
        onData
    ) {
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        onData(`Setting up build environment for project: ${projectName}\n`);
        const tokenResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", ["piacobelli"]);
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            onData(`No GitHub access token found\n`);
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        try {
            await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, outputDirectory, githubAccessToken });
            onData(`CodeBuild project configured for ${projectName}\n`);
            const imageUri = await this.streamCodeBuild({ projectName, repository, branch, githubAccessToken }, onData);
            onData(`Build completed successfully. Image pushed to ${imageUri}\n`);

            await pool.query(
                `UPDATE deployments 
                 SET root_directory = $1, output_directory = $2, build_command = $3, install_command = $4, env_vars = $5
                 WHERE deployment_id = $6`,
                [rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), deploymentId]
            );
            return logDir;
        } catch (error) {
            onData(`Error during build process: ${error.message}\n`);
            throw error;
        }
    }

    async launchContainer({
        userID,
        organizationID,
        projectName,
        domainName,          
        repository,
        branch,
        teamName,
        rootDirectory,
        installCommand,
        buildCommand,
        envVars,
        deploymentId,
        onData = null         
    }) {
        const emit = typeof onData === "function" ? onData : () => { };
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });

        const isBase = domainName === projectName;
        const subdomain = isBase ? null : domainName;
        let cfg = { repository, branch, rootDirectory, installCommand, buildCommand, envVars };
        if (!isBase) {
            const domResult = await pool.query(
                `SELECT repository,branch,root_directory,install_command,
                    build_command,env_vars
                FROM domains
                WHERE domain_name=$1
                AND project_id=(SELECT project_id FROM projects WHERE name=$2)`,
                [domainName, projectName]
            );
            if (!domResult.rows.length)
                throw new Error(`Domain ${domainName} not found for project ${projectName}.`);
            const row = domResult.rows[0];
            cfg = {
                repository: cfg.repository || row.repository,
                branch: cfg.branch || row.branch || "main",
                rootDirectory: cfg.rootDirectory || row.root_directory || ".",
                installCommand: cfg.installCommand || row.install_command || "npm install",
                buildCommand: cfg.buildCommand || row.build_command || "",
                envVars: cfg.envVars || (row.env_vars ? JSON.parse(row.env_vars) : [])
            };
        }

        emit(`Ensuring ECR repo "${projectName}" …\n`);
        await this.ensureECRRepo(projectName);

        emit(`Preparing CodeBuild project …\n`);
        await this.createCodeBuildProject({
            projectName,
            subdomain,
            repository: cfg.repository,
            branch: cfg.branch,
            rootDirectory: cfg.rootDirectory,
            installCommand: cfg.installCommand,
            buildCommand: cfg.buildCommand,
            githubAccessToken: (await pool.query(
                "SELECT github_access_token FROM users WHERE username=$1",
                [userID]
            )).rows[0].github_access_token
        });

        let imageUri;
        if (onData) {
            emit(`Streaming CodeBuild logs …\n`);
            imageUri = await this.streamCodeBuild(
                {
                    projectName, subdomain, repository: cfg.repository, branch: cfg.branch, githubAccessToken: (await pool.query(
                        "SELECT github_access_token FROM users WHERE username=$1",
                        [userID]
                    )).rows[0].github_access_token
                },
                emit
            );
        } else {
            const { imageUri: uri } = await this.startCodeBuild({
                projectName,
                subdomain,
                repository: cfg.repository,
                branch: cfg.branch,
                logDir,
                githubAccessToken: (await pool.query(
                    "SELECT github_access_token FROM users WHERE username=$1",
                    [userID]
                )).rows[0].github_access_token
            });
            imageUri = uri;
        }
        emit(`Image pushed: ${imageUri}\n`);

        const taskDefArn = await this.createTaskDef({
            projectName,
            subdomain,
            imageUri,
            envVars: cfg.envVars
        });
        emit(`Task‑def: ${taskDefArn}\n`);

        const targetGroupArn = await this.ensureTargetGroup(projectName, subdomain);
        emit(`Target‑group: ${targetGroupArn}\n`);

        await this.createOrUpdateService({
            projectName,
            subdomain,
            taskDefArn,
            targetGroupArn
        });
        emit("Service updated\n");
        return { imageUri, taskDefArn, logDir };
    }

    async launchWebsite({
        userID,
        organizationID,
        projectName,
        domainNames, 
        template,
        repository,
        branch,
        teamName,
        rootDirectory,
        outputDirectory,
        buildCommand,
        installCommand,
        envVars
    }) {
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        let projectID;
        let isNewProject = false;
        const domainIds = {};

        if (!Array.isArray(domainNames) || domainNames.length === 0) {
            throw new Error("domainNames must be a non-empty array of subdomains.");
        }

        const tokenResult = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;

        let commitSha;
        try {
            commitSha = await this.getLatestCommitSha(repository, branch, githubAccessToken);
        } catch (error) {
            fs.appendFileSync(
                path.join(logDir, "error.log"),
                `Failed to fetch commit SHA: ${error.message}\n`
            );
            throw error;
        }

        const existingProjRes = await pool.query(
            "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
            [organizationID, userID, projectName]
        );

        if (existingProjRes.rows.length > 0) {
            projectID = existingProjRes.rows[0].project_id;
            isNewProject = false;
        } else {
            isNewProject = true;
            projectID = uuidv4();
        }

        const taskDefArns = {};
        const urls = [];
        for (const domainName of domainNames) {
            const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
            const url = `https://${subdomain}.stackforgeengine.com`;
            urls.push(url);
            let domainId;
            let domainDetails = { repository, branch, rootDirectory, installCommand, buildCommand, envVars };
            if (subdomain !== projectName) {
                const domainResult = await pool.query(
                    `SELECT repository, branch, root_directory, install_command, build_command, env_vars
                     FROM domains
                     WHERE domain_name = $1 AND project_id = (SELECT project_id FROM projects WHERE name = $2)`,
                    [subdomain, projectName]
                );
                if (domainResult.rows.length > 0) {
                    domainDetails = {
                        repository: domainResult.rows[0].repository || repository,
                        branch: domainResult.rows[0].branch || branch,
                        rootDirectory: domainResult.rows[0].root_directory || rootDirectory,
                        installCommand: domainResult.rows[0].install_command || installCommand,
                        buildCommand: domainResult.rows[0].build_command || buildCommand,
                        envVars: domainResult.rows[0].env_vars || envVars
                    };
                }
            }

            if (!isNewProject) {
                const existingDomainResult = await pool.query(
                    "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
                    [projectID, subdomain]
                );
                if (existingDomainResult.rows.length > 0) {
                    domainId = existingDomainResult.rows[0].domain_id;
                    await pool.query(
                        `UPDATE domains
                         SET updated_at = $1, deployment_id = $2, repository = $3, branch = $4, root_directory = $5, output_directory = $6, build_command = $7, install_command = $8, env_vars = $9
                         WHERE domain_id = $10`,
                        [timestamp, deploymentId, repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), domainId]
                    );
                } else {
                    domainId = uuidv4();
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
                        [
                            organizationID,
                            userID,
                            domainId,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            deploymentId,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars)
                        ]
                    );
                }
                domainIds[subdomain] = domainId;
            } else {
                domainId = uuidv4();
                domainIds[subdomain] = domainId;
            }

            await this.ensureECRRepo(projectName);
            await this.createCodeBuildProject({
                projectName,
                subdomain,
                repository: domainDetails.repository,
                branch: domainDetails.branch,
                rootDirectory: domainDetails.rootDirectory,
                installCommand: domainDetails.installCommand,
                buildCommand: domainDetails.buildCommand,
                githubAccessToken
            });

            const { imageUri } = await this.startCodeBuild({
                projectName,
                subdomain,
                repository: domainDetails.repository,
                branch: domainDetails.branch,
                logDir,
                githubAccessToken
            });

            const taskDefArn = await this.createTaskDef({
                projectName,
                subdomain,
                imageUri,
                envVars: domainDetails.envVars
            });
            taskDefArns[subdomain] = taskDefArn;

            const targetGroupArn = await this.ensureTargetGroup(projectName, subdomain);

            await this.updateDNSRecord(projectName, [subdomain], targetGroupArn);
            await this.createOrUpdateService({
                projectName,
                subdomain,
                taskDefArn,
                targetGroupArn
            });
            await pool.query(
                `UPDATE deployments 
                 SET root_directory = $1, build_command = $2, install_command = $3, env_vars = $4
                 WHERE deployment_id = $5`,
                [domainDetails.rootDirectory, domainDetails.buildCommand, domainDetails.installCommand, JSON.stringify(domainDetails.envVars), deploymentId]
            );

            if (subdomain !== projectName) {
                await pool.query(
                    `UPDATE domains
                     SET repository = $1, branch = $2, root_directory = $3, install_command = $4, build_command = $5, env_vars = $6
                     WHERE domain_name = $7 AND project_id = (SELECT project_id FROM projects WHERE name = $8)`,
                    [
                        domainDetails.repository,
                        domainDetails.branch,
                        domainDetails.rootDirectory,
                        domainDetails.installCommand,
                        domainDetails.buildCommand,
                        JSON.stringify(domainDetails.envVars),
                        subdomain,
                        projectName
                    ]
                );
            }
        }

        try {
            await this.updateDNSRecord(projectName, domainNames);

            const records = {};
            for (const domainName of domainNames) {
                const fqdn = `${domainName}.stackforgeengine.com`;
                records[fqdn] = [];
                try {
                    const a = await dns.resolve4(fqdn);
                    if (a.length) records[fqdn].push({ type: "A", name: "@", value: a[0] });
                } catch (error) { }
                try {
                    const aaaa = await dns.resolve6(fqdn);
                    if (aaaa.length) records[fqdn].push({ type: "AAAA", name: "@", value: aaaa[0] });
                } catch (error) { }
                try {
                    const cname = await dns.resolveCname(fqdn);
                    if (cname.length) records[fqdn].push({ type: "CNAME", name: "@", value: cname[0] });
                } catch (error) { }
                try {
                    const mx = await dns.resolveMx(fqdn);
                    if (mx.length)
                        records[fqdn].push({
                            type: "MX",
                            name: "@",
                            value: mx.map((r) => `${r.priority} ${r.exchange}`).join(", ")
                        });
                } catch (error) { }
            }

            if (isNewProject) {
                await pool.query(
                    `INSERT INTO projects 
                     (orgid, username, project_id, name, description, branch, team_name, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image) 
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        null,
                        branch,
                        teamName,
                        userID,
                        timestamp,
                        timestamp,
                        urls[0],
                        repository,
                        null,
                        deploymentId,
                        null
                    ]
                );

                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    const domainId = domainIds[subdomain];
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars, dns_records) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                        [
                            organizationID,
                            userID,
                            domainId,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            deploymentId,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars),
                            JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || [])
                        ]
                    );
                }

                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                    [
                        organizationID,
                        userID,
                        deploymentId,
                        projectID,
                        domainIds[domainNames[0]],
                        "active",
                        urls[0],
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArns[domainNames[0]],
                        commitSha,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars)
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
                        "launch",
                        deploymentId,
                        timestamp,
                        "127.0.0.1"
                    ]
                );
            } else {
                const now = new Date().toISOString();
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                    ["inactive", now, projectID, "active"]
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
                        domainIds[domainNames[0]],
                        "active",
                        urls[0],
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArns[domainNames[0]],
                        commitSha,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars)
                    ]
                );

                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    await pool.query(
                        "UPDATE domains SET dns_records = $1 WHERE domain_id = $2",
                        [JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || []), domainIds[subdomain]]
                    );
                }
            }

            await this.recordBuildLogs(organizationID, userID, deploymentId, logDir);
            await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            return { urls, deploymentId, logPath: logDir, taskDefArns };
        } catch (error) {
            await this.cleanupFailedDeployment({
                organizationID,
                userID,
                projectID,
                projectName,
                domainName: domainNames[0],
                deploymentId,
                domainId: domainIds[domainNames[0]],
                certificateArn: null,
                targetGroupArn: null
            });
            throw error;
        }
    }

    async launchWebsiteStream(
        {
            userID,
            organizationID,
            projectName,
            domainNames, 
            template,
            repository,
            branch,
            teamName,
            rootDirectory,
            outputDirectory,
            buildCommand,
            installCommand,
            envVars
        },
        onData
    ) {
        if (typeof onData !== "function") {
            throw new Error(`launchWebsiteStream: onData is not a function, received: ${typeof onData}.`);
        }
        onData(`Starting deployment for project: ${projectName}\n`);
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        try {
            fs.mkdirSync(logDir, { recursive: true });
            onData(`Created log directory: ${logDir}\n`);
        } catch (error) {
            onData(`Failed to set up log directory: ${error.message}\n`);
            throw new Error(`Log directory setup failed: ${error.message}.`);
        }
        let projectID;
        let isNewProject = false;
        const domainIds = {};

        if (!Array.isArray(domainNames) || domainNames.length === 0) {
            onData(`Error: domainNames must be a non-empty array\n`);
            throw new Error("domainNames must be a non-empty array of subdomains.");
        }

        const tokenResult = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            onData(`No GitHub access token found for user: ${userID}\n.`);
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        onData(`GitHub access token retrieved successfully\n`);

        let commitSha;
        try {
            commitSha = await this.getLatestCommitSha(repository, branch, githubAccessToken);
            onData(`Fetched latest commit SHA: ${commitSha}\n`);
        } catch (error) {
            onData(`Failed to fetch commit SHA: ${error.message}\n`);
            throw error;
        }

        try {
            onData(`Checking for existing project: ${projectName}\n`);
            const existingProjResult = await pool.query(
                "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
                [organizationID, userID, projectName]
            );
            if (existingProjResult.rows.length > 0) {
                projectID = existingProjResult.rows[0].project_id;
                onData(`Existing project found, ID: ${projectID}\n`);
                isNewProject = false;
            } else {
                isNewProject = true;
                projectID = uuidv4();
                onData(`New project created, ID: ${projectID}\n`);
            }
        } catch (error) {
            onData(`Error checking project: ${error.message}\n`);
            throw new Error(`Project check failed: ${error.message}.`);
        }

        const taskDefArns = {};
        const urls = [];
        let streamBuffer = "";
        for (const domainName of domainNames) {
            const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
            const url = `https://${subdomain}.stackforgeengine.com`;
            urls.push(url);
            let domainId;

            if (!isNewProject) {
                onData(`Checking for existing domain: ${subdomain}\n`);
                const existingDomainResult = await pool.query(
                    "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
                    [projectID, subdomain]
                );
                if (existingDomainResult.rows.length > 0) {
                    domainId = existingDomainResult.rows[0].domain_id;
                    onData(`Existing domain found, ID: ${domainId}\n`);
                    await pool.query(
                        `UPDATE domains
                         SET updated_at = $1, deployment_id = $2, repository = $3, branch = $4, root_directory = $5, output_directory = $6, build_command = $7, install_command = $8, env_vars = $9
                         WHERE domain_id = $10`,
                        [timestamp, deploymentId, repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), domainId]
                    );
                    onData(`Updated domain timestamp and deployment_id\n`);
                } else {
                    domainId = uuidv4();
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                        [
                            organizationID,
                            userID,
                            domainId,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            subdomain === projectName,
                            deploymentId,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars)
                        ]
                    );
                    onData(`Created new domain, ID: ${domainId}\n`);
                }
                domainIds[subdomain] = domainId;
            } else {
                domainId = uuidv4();
                domainIds[subdomain] = domainId;
            }

            onData(`Ensuring ECR repository for ${projectName}\n`);
            await this.ensureECRRepo(projectName);
            onData(`ECR repository ensured for ${projectName}\n`);

            onData(`Creating/updating CodeBuild project for ${projectName}, subdomain: ${subdomain}\n`);
            await this.createCodeBuildProject({
                projectName,
                subdomain,
                repository,
                branch,
                rootDirectory,
                installCommand,
                buildCommand,
                outputDirectory,
                githubAccessToken
            });
            onData(`CodeBuild project created/updated for ${projectName}\n`);

            onData(`Starting CodeBuild process for subdomain: ${subdomain}\n`);
            const capturingOnData = (chunk) => {
                streamBuffer += chunk;
                onData(chunk);
            };
            const imageUri = await this.streamCodeBuild(
                {
                    projectName,
                    subdomain,
                    repository,
                    branch,
                    githubAccessToken
                },
                capturingOnData
            );
            onData(`Docker image pushed to ${imageUri}\n`);

            onData(`Registering ECS task definition for subdomain: ${subdomain}\n`);
            const taskDefArn = await this.createTaskDef({
                projectName,
                subdomain,
                imageUri,
                envVars
            });
            taskDefArns[subdomain] = taskDefArn;
            onData(`ECS task definition registered: ${taskDefArn}\n`);

            onData(`Ensuring target group for subdomain: ${subdomain}\n`);
            const targetGroupArn = await this.ensureTargetGroup(projectName, subdomain);
            onData(`Target group ensured: ${targetGroupArn}\n`);

            await this.updateDNSRecord(projectName, [subdomain], targetGroupArn);
            onData(`DNS / ALB rule created for ${subdomain}.stackforgeengine.com\n`);
            onData(`Creating/updating ECS service for subdomain: ${subdomain}\n`);

            await this.createOrUpdateService({
                projectName,
                subdomain,
                taskDefArn,
                targetGroupArn
            });
            onData(`ECS service created/updated for ${projectName}\n`);
            onData(`Checking ECS service status for subdomain: ${subdomain}\n`);

            try {
                const serviceDesc = await this.ecs.send(
                    new DescribeServicesCommand({
                        cluster: process.env.ECS_CLUSTER,
                        services: [subdomain ? `${projectName}-${subdomain.replace(/\./g, '-')}` : projectName]
                    })
                );
                const service = serviceDesc.services?.[0];
                if (service) {
                    onData(`Service Status: ${service.status}, Desired Count: ${service.desiredCount}, Running Count: ${service.runningCount}\n`);
                    if (service.runningCount === 0) {
                        onData(`Warning: No tasks are running for service ${projectName}\n`);
                    }
                    if (service.events?.length > 0) {
                        onData(`Recent Service Events:\n`);
                        service.events.slice(0, 5).forEach((event) => {
                            onData(`${event.createdAt}: ${event.message}\n`);
                        });
                    }
                } else {
                    onData(`Error: Service ${projectName} not found\n`);
                }
            } catch (error) {
                onData(`Error checking ECS service status: ${error.message}\n`);
            }
        }

        try {
            onData(`Updating DNS records for project ${projectName}\n`);
            await this.updateDNSRecord(projectName, domainNames);
            onData("DNS records updated successfully\n");

            const records = {};
            for (const domainName of domainNames) {
                const fqdn = `${domainName}.stackforgeengine.com`;
                records[fqdn] = [];
                try { const a = await dns.resolve4(fqdn); if (a.length) records[fqdn].push({ type: "A", name: "@", value: a[0] }); } catch { }
                try { const aaaa = await dns.resolve6(fqdn); if (aaaa.length) records[fqdn].push({ type: "AAAA", name: "@", value: aaaa[0] }); } catch { }
                try { const cname = await dns.resolveCname(fqdn); if (cname.length) records[fqdn].push({ type: "CNAME", name: "@", value: cname[0] }); } catch { }
                try { const mx = await dns.resolveMx(fqdn); if (mx.length) records[fqdn].push({ type: "MX", name: "@", value: mx.map(r => `${r.priority} ${r.exchange}`).join(", ") }); } catch { }
            }

            if (isNewProject) {
                onData(`Creating new project record\n`);
                await pool.query(
                    `INSERT INTO projects 
                     (orgid, username, project_id, name, description, branch, team_name, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        null,
                        branch,
                        teamName,
                        userID,
                        timestamp,
                        timestamp,
                        urls[0],
                        repository,
                        null,
                        deploymentId,
                        null
                    ]
                );
                onData(`Project record created\n`);

                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars, dns_records) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
                        [
                            organizationID,
                            userID,
                            domainIds[subdomain],
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            subdomain === projectName,
                            deploymentId,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars),
                            JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || [])
                        ]
                    );
                    onData(`Domain record created for ${subdomain}\n`);
                }

                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                    [
                        organizationID,
                        userID,
                        deploymentId,
                        projectID,
                        domainIds[domainNames[0]],
                        "active",
                        urls[0],
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArns[domainNames[0]],
                        commitSha,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars)
                    ]
                );
                onData(`Deployment record created\n`);
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        "launch",
                        deploymentId,
                        timestamp,
                        "127.0.0.1"
                    ]
                );
                onData(`Deployment log created\n`);
            } else {
                const now = new Date().toISOString();
                onData(`Updating deployment status to active\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                    ["inactive", now, projectID, "active"]
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
                        domainIds[domainNames[0]],
                        "active",
                        urls[0],
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArns[domainNames[0]],
                        commitSha,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars)
                    ]
                );
                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    await pool.query(
                        "UPDATE domains SET dns_records = $1 WHERE domain_id = $2",
                        [JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || []), domainIds[subdomain]]
                    );
                }
                onData(`Deployment status updated\n`);
            }

            onData(`Recording build logs\n`);
            await this.recordBuildLogs(organizationID, userID, deploymentId, logDir, streamBuffer);
            onData(`Build logs recorded\n`);
            onData(`Recording runtime logs\n`);
            await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            onData(`Runtime logs recorded\n`);
            return { urls, deploymentId, logPath: logDir, taskDefArns };
        } catch (error) {
            onData(`Deployment failed: ${error.message}\n`);
            await this.cleanupFailedDeployment({
                organizationID,
                userID,
                projectID,
                projectName,
                domainName: domainNames[0],
                deploymentId,
                domainId: domainIds[domainNames[0]],
                certificateArn: null,
                targetGroupArn: null
            });
            throw error;
        }
    }

    async recordBuildLogs(orgid, username, deploymentId, logDir, streamBuffer = "") {
        let fileLogs = "";
        try {
            const files = fs.readdirSync(logDir).filter(f => f.endsWith(".log"));
            for (const f of files) {
                fileLogs += fs.readFileSync(path.join(logDir, f), "utf-8") + "\n";
                await s3Client.send(new PutObjectCommand({
                    Bucket: process.env.S3_LOGS_BUCKET_NAME,
                    Key: `build-logs/${deploymentId}/${f}`,
                    Body: fs.readFileSync(path.join(logDir, f))
                }));
            }
        } catch (error) {
            fileLogs = `Error reading log files: ${error.message}\n`;
        }
        const combined = fileLogs + streamBuffer;
        await pool.query(
            `INSERT INTO build_logs 
             (orgid, username, deployment_id, build_log_id, timestamp, log_path, log_messages)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
                orgid,
                username,
                deploymentId,
                uuidv4(),
                new Date().toISOString(),
                `s3://${process.env.S3_LOGS_BUCKET_NAME}/build-logs/${deploymentId}`,
                combined
            ]
        );
    }

    async recordRuntimeLogs(orgid, username, deploymentId, projectName, subdomain) {
        try {
            const taskFamily = subdomain
                ? `${projectName}-${subdomain.replace(/\./g, '-')}`
                : projectName;
            const logGroupName = `/ecs/${taskFamily}`;
            const logStreamName = `ecs/${projectName}-${deploymentId}`;

            await this.ensureLogGroup(logGroupName);

            try {
                await cloudWatchLogsClient.send(new CreateLogStreamCommand({
                    logGroupName,
                    logStreamName
                }));
            } catch (error) {}

            let events = [];
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    const resp = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                        logGroupName,
                        logStreamName,
                        limit: 100
                    }));
                    events = resp.events || [];
                    break;
                } catch (error) {
                    if (error.name === 'ResourceNotFoundException' && attempt < 5) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else {
                        throw new Error(`Failed to fetch logs: ${error.message}.`);
                    }
                }
            }

            const logMessages = events.map(e => ({ timestamp: e.timestamp, message: e.message }));
            for (const log of logMessages) {
                if (log.message.includes('200 OK')) { httpStatus = '200'; break; }
                if (log.message.includes('500 Internal Server Error')) { httpStatus = '500'; break; }
            }

            const runtimeLogPath = `runtime-logs/${deploymentId}/${uuidv4()}.log`;
            const logContent = JSON.stringify(logMessages, null, 2);
            try {
                await s3Client.send(new PutObjectCommand({
                    Bucket: process.env.S3_LOGS_BUCKET_NAME,
                    Key: runtimeLogPath,
                    Body: logContent
                }));
            } catch (error) {}

            const logId = uuidv4();
            await pool.query(`
                INSERT INTO runtime_logs (orgid, username, deployment_id, build_log_id, timestamp, runtime_messages, runtime_path) 
                VALUES ($1, $2, $3, $4, NOW(), $5, $6)
            `, [
                orgid,
                username,
                deploymentId,
                logId,
                JSON.stringify(logMessages),
                `s3://${process.env.S3_LOGS_BUCKET_NAME}/${runtimeLogPath}`
            ]);
        } catch (error) {
            return;
        }
    }

    async updateDNSRecord(projectName, subdomains, targetGroupArn = null) {
        const route53Client = new Route53Client({ region: process.env.AWS_REGION });
        const elbClient = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const acmClient = new ACMClient({ region: process.env.AWS_REGION });
        const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
        const albZoneId = process.env.LOAD_BALANCER_ZONE_ID;
        const albDns = process.env.LOAD_BALANCER_DNS.endsWith(".")
            ? process.env.LOAD_BALANCER_DNS : `${process.env.LOAD_BALANCER_DNS}.`;
        if (!hostedZoneId || !albZoneId || !albDns)
            throw new Error("Route-53 / ALB env vars are missing.");

        projectName = projectName.toLowerCase();

        const fqdnSet = new Set();
        (Array.isArray(subdomains) ? subdomains : []).forEach(raw => {
            const s = raw.trim().toLowerCase();
            if (!s) return;
            const fqdn = s === projectName
                ? `${projectName}.stackforgeengine.com`
                : `${s}.stackforgeengine.com`;
            fqdnSet.add(fqdn);
        });
        const fqdnList = Array.from(fqdnSet);
        const wildcardSubdomain = `*.${projectName}.stackforgeengine.com`;
        let certificateArn = process.env.CERTIFICATE_ARN || "arn:aws:acm:us-east-1:913524945973:certificate/d84f519d-2502-477f-8512-3d060065ed78";
        const { Certificate } = await acmClient.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
        const certDomains = Certificate.SubjectAlternativeNames || [];

        if (!certDomains.includes(wildcardSubdomain) && fqdnList.some(fqdn => fqdn !== `${projectName}.stackforgeengine.com`)) {
            try {
                const certResponse = await acmClient.send(new RequestCertificateCommand({
                    DomainName: `${projectName}.stackforgeengine.com`,
                    SubjectAlternativeNames: [
                        `${projectName}.stackforgeengine.com`,
                        wildcardSubdomain
                    ],
                    ValidationMethod: "DNS"
                }));
                certificateArn = certResponse.CertificateArn;

                for (let i = 0; i < 30; i++) {
                    const { Certificate } = await acmClient.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
                    const domainValidation = Certificate.DomainValidationOptions?.find(opt => opt.DomainName === wildcardSubdomain);
                    if (domainValidation?.ResourceRecord) {
                        await route53Client.send(new ChangeResourceRecordSetsCommand({
                            HostedZoneId: hostedZoneId,
                            ChangeBatch: {
                                Changes: [{
                                    Action: "UPSERT",
                                    ResourceRecordSet: {
                                        Name: domainValidation.ResourceRecord.Name,
                                        Type: domainValidation.ResourceRecord.Type,
                                        TTL: 300,
                                        ResourceRecords: [{ Value: domainValidation.ResourceRecord.Value }]
                                    }
                                }]
                            }
                        }));
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }

                for (let i = 0; i < 60; i++) {
                    const { Certificate } = await acmClient.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
                    if (Certificate.Status === "ISSUED") {
                        break;
                    }
                    if (Certificate.Status === "FAILED") {
                        throw new Error(`Certificate issuance failed: ${Certificate.FailureReason}.`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            } catch (error) {
                throw error;
            }
        }

        const deletesMap = new Map();
        for (const fqdn of fqdnList) {
            let next = null;
            do {
                const list = await route53Client.send(
                    new ListResourceRecordSetsCommand({
                        HostedZoneId: hostedZoneId,
                        StartRecordName: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                        StartRecordType: next?.type,
                        StartRecordIdentifier: next?.id
                    })
                );
                for (const rec of list.ResourceRecordSets) {
                    if (rec.Name.replace(/\.$/, "") !== fqdn) break;
                    deletesMap.set(`${rec.Name}|${rec.Type}`, { Action: "DELETE", ResourceRecordSet: rec });
                }
                next = list.IsTruncated
                    ? { name: list.NextRecordName, type: list.NextRecordType, id: list.NextRecordIdentifier }
                    : null;
            } while (next);
        }

        const upsertsMap = new Map();
        for (const fqdn of fqdnList) {
            const apex = fqdn === `${projectName}.stackforgeengine.com`;
            const rec = apex ? {
                Name: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                Type: "A",
                AliasTarget: {
                    HostedZoneId: albZoneId,
                    DNSName: albDns,
                    EvaluateTargetHealth: false
                }
            } : {
                Name: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                Type: "CNAME",
                TTL: 30,
                ResourceRecords: [{ Value: `${projectName}.stackforgeengine.com.` }]
            };
            upsertsMap.set(`${rec.Name}|${rec.Type}`, { Action: "UPSERT", ResourceRecordSet: rec });
        }

        for (const k of upsertsMap.keys()) {
            const del = deletesMap.get(k);
            if (del && JSON.stringify(del.ResourceRecordSet) === JSON.stringify(upsertsMap.get(k).ResourceRecordSet)) {
                deletesMap.delete(k);
                upsertsMap.delete(k);
            }
        }

        const sendBatch = async (changes) => {
            if (changes.length === 0) return;
            try {
                const response = await route53Client.send(
                    new ChangeResourceRecordSetsCommand({
                        HostedZoneId: hostedZoneId,
                        ChangeBatch: { Changes: changes }
                    })
                );
            } catch (error) {
                throw error;
            }
        };
        const delArr = Array.from(deletesMap.values());
        for (let i = 0; i < delArr.length; i += 100) await sendBatch(delArr.slice(i, i + 100));
        const upArr = Array.from(upsertsMap.values());
        for (let i = 0; i < upArr.length; i += 100) await sendBatch(upArr.slice(i, i + 100));

        for (const fqdn of fqdnList) {
            try {
                const { ResourceRecordSets } = await route53Client.send(
                    new ListResourceRecordSetsCommand({
                        HostedZoneId: hostedZoneId,
                        StartRecordName: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                        MaxItems: 1
                    })
                );
                const record = ResourceRecordSets.find(rec => rec.Name.replace(/\.$/, "") === fqdn);
    
            } catch (error) {}
        }

        if (targetGroupArn) {
            const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
            const pickPriority = async () => {
                const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                const used = new Set(Rules.filter(r => !r.IsDefault).map(r => parseInt(r.Priority, 10)));
                for (let p = 1; p <= 50000; p++) if (!used.has(p)) return p;
                throw new Error("No free ALB priority.");
            };

            for (const fqdn of fqdnList) {
                const ruleExists = async () => {
                    const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                    const rule = Rules.find(r =>
                        !r.IsDefault &&
                        r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn)) &&
                        r.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === targetGroupArn)
                    );
                    return rule ? rule.RuleArn : null;
                };

                const existingRuleArn = await ruleExists();
                if (existingRuleArn) {
                    await elbClient.send(new ModifyRuleCommand({
                        RuleArn: existingRuleArn,
                        Conditions: [{ Field: "host-header", Values: [fqdn] }],
                        Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
                    }));
                } else {
                    const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                    const outdatedRule = Rules.find(r =>
                        !r.IsDefault &&
                        r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(fqdn))
                    );
                    if (outdatedRule) {
                        await elbClient.send(new DeleteRuleCommand({ RuleArn: outdatedRule.RuleArn }));
                    }
                    const priority = await pickPriority();
                    await elbClient.send(new CreateRuleCommand({
                        ListenerArn: listenerArn,
                        Priority: priority,
                        Conditions: [{ Field: "host-header", Values: [fqdn] }],
                        Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
                    }));
                }
            }
        }

        return { certificateArn };
    }

    async rollbackDeployment({ organizationID, userID, projectID, deploymentID }) {
        const timestamp = new Date().toISOString();
        const deploymentResult = await pool.query(
            `SELECT d.*, p.name as project_name, d.url
             FROM deployments d
             JOIN projects p ON d.project_id = p.project_id
             WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3`,
            [deploymentID, organizationID, userID]
        );
        if (deploymentResult.rows.length === 0) {
            throw new Error("Deployment not found or access denied.");
        }
        const deployment = deploymentResult.rows[0];
        const projectName = deployment.project_name;
        const taskDefArn = await this.getTaskDefinitionARN(projectName, deploymentID);
        const cluster = process.env.ECS_CLUSTER;
        const serviceName = projectName;

        const depDomainsRes = await pool.query(
            `SELECT d.domain_name
             FROM domains d
             JOIN deployments dep ON d.domain_id = dep.domain_id
             WHERE dep.deployment_id = $1`,
            [deploymentID]
        );
        const activeSubdomains = depDomainsRes.rows.map(r => r.domain_name);
        const activeFQDNs = activeSubdomains.map(sub =>
            sub.includes('.') ? sub : `${sub}.stackforgeengine.com`
        );

        const allDomainsRes = await pool.query(
            "SELECT domain_name FROM domains WHERE project_id = $1",
            [projectID]
        );
        const allFQDNs = allDomainsRes.rows.map(r =>
            r.domain_name.includes('.') ? r.domain_name : `${r.domain_name}.stackforgeengine.com`
        );

        await this.ecs.send(new UpdateServiceCommand({
            cluster,
            service: serviceName,
            taskDefinition: taskDefArn,
            forceNewDeployment: true
        }));

        const listeners = [
            { arn: process.env.ALB_LISTENER_ARN_HTTPS, isHttps: true },
            { arn: process.env.ALB_LISTENER_ARN_HTTP, isHttps: false }
        ];
        const targetGroupArn = await this.ensureTargetGroup(projectName);

        for (const { arn: listenerArn, isHttps } of listeners) {
            const rulesResp = await this.elbv2.send(new DescribeRulesCommand({
                ListenerArn: listenerArn
            }));

            for (const rule of rulesResp.Rules) {
                const hostCond = rule.Conditions.find(c => c.Field === "host-header");
                if (hostCond && !activeFQDNs.includes(hostCond.Values[0])) {
                    await this.elbv2.send(new DeleteRuleCommand({
                        RuleArn: rule.RuleArn
                    }));
                }
            }

            const updatedRules = await this.elbv2.send(new DescribeRulesCommand({
                ListenerArn: listenerArn
            }));
            const usedPriorities = updatedRules.Rules
                .map(r => parseInt(r.Priority))
                .filter(n => !isNaN(n));
            let nextPriority = usedPriorities.length ? Math.max(...usedPriorities) + 1 : 1;

            for (const domain of activeFQDNs) {
                const existing = updatedRules.Rules.find(r =>
                    r.Conditions.some(c => c.Field === "host-header" && c.Values.includes(domain))
                );
                const actions = isHttps
                    ? [{ Type: "forward", TargetGroupArn: targetGroupArn }]
                    : [{
                        Type: "redirect",
                        RedirectConfig: {
                            Protocol: "HTTPS",
                            Port: "443",
                            StatusCode: "HTTP_301",
                            Host: "#{host}",
                            Path: "/#{path}",
                            Query: "#{query}"
                        }
                    }];

                if (existing) {
                    await this.elbv2.send(new ModifyRuleCommand({
                        RuleArn: existing.RuleArn,
                        Conditions: [{ Field: "host-header", Values: [domain] }],
                        Actions: actions
                    }));
                } else {
                    await this.elbv2.send(new CreateRuleCommand({
                        ListenerArn: listenerArn,
                        Priority: nextPriority++,
                        Conditions: [{ Field: "host-header", Values: [domain] }],
                        Actions: actions
                    }));
                }
            }
        }

        await pool.query(
            "UPDATE deployments SET status = 'inactive', updated_at = $1 WHERE project_id = $2 AND status = 'active'",
            [timestamp, projectID]
        );
        await pool.query(
            "UPDATE deployments SET status = 'active', updated_at = $1, last_deployed_at = $1 WHERE deployment_id = $2",
            [timestamp, deploymentID]
        );

        await pool.query(
            `UPDATE projects
             SET previous_deployment = current_deployment,
                 current_deployment = $1,
                 updated_at = $2
             WHERE project_id = $3`,
            [deploymentID, timestamp, projectID]
        );

        await pool.query(
            "UPDATE domains SET is_primary = false WHERE project_id = $1",
            [projectID]
        );
        await pool.query(
            "UPDATE domains SET is_primary = true WHERE project_id = $1 AND domain_name = ANY($2)",
            [projectID, activeSubdomains]
        );

        await pool.query(
            `INSERT INTO deployment_logs
             (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address)
             VALUES ($1, $2, $3, $4, 'rollback', $5, $6, '127.0.0.1')`,
            [organizationID, userID, projectID, projectName, deploymentID, timestamp]
        );

        await this.recordRuntimeLogs(organizationID, userID, deploymentID, projectName);

        return {
            message: `Successfully rolled back to deployment ${deploymentID}.`,
            url: deployment.url,
            deploymentId: deploymentID
        };
    }

    async deleteProject({ organizationID, userID, projectID, projectName, domainName }) {
        const timestamp = new Date().toISOString();
        const acmClient = new ACMClient({ region: process.env.AWS_REGION });
        const route53Client = new Route53Client({ region: process.env.AWS_REGION });
        const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const codeBuildClient = new CodeBuildClient({ region: process.env.AWS_REGION });
        const cloudWatchLogsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
        const ecrClient = new ECRClient({ region: process.env.AWS_REGION });
        const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
        const cloudFrontClient = new CloudFrontClient({ region: process.env.AWS_REGION });

        try {
            const projectResult = await pool.query(
                "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                [projectID, organizationID, userID]
            );
            if (projectResult.rows.length === 0) {
                throw new Error("Project not found or access denied.");
            }

            const domainResult = await pool.query(
                "SELECT domain_name, certificate_arn, target_group_arn FROM domains WHERE project_id = $1 AND orgid = $2",
                [projectID, organizationID]
            );
            const domains = domainResult.rows.map(row => ({
                name: row.domain_name.includes(".") ? row.domain_name : `${row.domain_name}.stackforgeengine.com`,
                certificateArn: row.certificate_arn,
                targetGroupArn: row.target_group_arn
            }));

            const domainsToClean = new Set([
                `${projectName}.stackforgeengine.com`,
                `*.${projectName}.stackforgeengine.com`,
                ...domains.map(d => d.name)
            ]);

            try {
                const serviceName = domainName && domainName !== projectName ? `${projectName}-${domainName}` : projectName;
                const tasksResp = await ecsClient.send(new ListTasksCommand({
                    cluster: process.env.ECS_CLUSTER_ARN,
                    serviceName: serviceName
                }));
                for (const taskArn of tasksResp.taskArns || []) {
                    await ecsClient.send(new StopTaskCommand({
                        cluster: process.env.ECS_CLUSTER_ARN,
                        task: taskArn,
                        reason: `Stopping task for project ${projectName} deletion`
                    }));
                }

                await ecsClient.send(new DeleteServiceCommand({
                    cluster: process.env.ECS_CLUSTER_ARN,
                    service: serviceName,
                    force: true
                }));

                const taskDefsResp = await ecsClient.send(new ListTaskDefinitionsCommand({
                    familyPrefix: serviceName
                }));
                for (const taskDefArn of taskDefsResp.taskDefinitionArns || []) {
                    await ecsClient.send(new DeregisterTaskDefinitionCommand({
                        taskDefinition: taskDefArn
                    }));
                }
            } catch (error) {}

            try {
                await ecrClient.send(new DeleteRepositoryCommand({
                    repositoryName: projectName,
                    force: true
                }));
            } catch (error) {}

            try {
                const changes = [];
                for (const domain of domainsToClean) {
                    const recordName = domain.endsWith(".") ? domain : `${domain}.`;
                    const listResp = await route53Client.send(new ListResourceRecordSetsCommand({
                        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                        StartRecordName: recordName,
                        MaxItems: "10"
                    }));
                    const records = listResp.ResourceRecordSets.filter(r =>
                        r.Name === recordName &&
                        ["A", "CNAME", "MX", "AAAA"].includes(r.Type)
                    );
                    for (const record of records) {
                        changes.push({
                            Action: "DELETE",
                            ResourceRecordSet: record
                        });
                    }
                }
                if (changes.length > 0) {
                    await route53Client.send(new ChangeResourceRecordSetsCommand({
                        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                        ChangeBatch: { Changes: changes }
                    }));
                }
            } catch (error) {}

            const listenerArns = [process.env.ALB_LISTENER_ARN_HTTP, process.env.ALB_LISTENER_ARN_HTTPS];
            for (const listenerArn of listenerArns) {
                try {
                    const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                        ListenerArn: listenerArn
                    }));
                    for (const rule of rulesResp.Rules) {
                        if (rule.IsDefault) {
                            continue;
                        }
                        const isProjectRule = rule.Conditions.some(c =>
                            c.Field === "host-header" &&
                            (domainsToClean.has(c.Values[0]) || c.Values.some(v => domainsToClean.has(v)))
                        ) || rule.Actions.some(a =>
                            a.Type === "forward" &&
                            domains.map(d => d.targetGroupArn).includes(a.TargetGroupArn)
                        );
                        if (isProjectRule) {
                            await elbv2Client.send(new DeleteRuleCommand({
                                RuleArn: rule.RuleArn
                            }));
                        }
                    }
                } catch (error) {}
            }

            const certificateArns = [...new Set(domains
                .map(d => d.certificateArn)
                .filter(arn => arn))]; 
            for (const certArn of certificateArns) {
                try {
                    const maxDetachRetries = 5;
                    let detachRetryCount = 0;
                    let isDetached = false;
                    while (detachRetryCount < maxDetachRetries && !isDetached) {
                        const listenersResp = await elbv2Client.send(new DescribeListenersCommand({
                            LoadBalancerArn: process.env.LOAD_BALANCER_ARN
                        }));
                        let foundCert = false;
                        for (const listener of listenersResp.Listeners || []) {
                            const certsResp = await elbv2Client.send(new DescribeListenerCertificatesCommand({
                                ListenerArn: listener.ListenerArn
                            }));
                            const listenerCerts = certsResp.Certificates?.map(c => c.CertificateArn) || [];
                            if (listenerCerts.includes(certArn)) {
                                foundCert = true;
                                await elbv2Client.send(new DeleteListenerCertificatesCommand({
                                    ListenerArn: listener.ListenerArn,
                                    Certificates: [{ CertificateArn: certArn }]
                                }));
                            }
                        }
                        if (!foundCert) {
                            isDetached = true;
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 15000)); 
                        detachRetryCount++;
                    }

                    try {
                        const distributions = await cloudFrontClient.send(new ListDistributionsCommand({}));
                        const cloudFrontUsage = distributions.DistributionList?.Items?.filter(dist =>
                            dist.ViewerCertificate?.ACMCertificateArn === certArn
                        ) || [];
                        if (cloudFrontUsage.length > 0) {
                            continue; 
                        }
                    } catch (error) {}

                    try {
                        const loadBalancersResp = await elbv2Client.send(new DescribeLoadBalancersCommand({}));
                        for (const lb of loadBalancersResp.LoadBalancers || []) {
                            const lbListeners = await elbv2Client.send(new DescribeListenersCommand({
                                LoadBalancerArn: lb.LoadBalancerArn
                            }));
                            for (const listener of lbListeners.Listeners || []) {
                                const certsResp = await elbv2Client.send(new DescribeListenerCertificatesCommand({
                                    ListenerArn: listener.ListenerArn
                                }));
                                if (certsResp.Certificates?.some(c => c.CertificateArn === certArn)) {
                                    await elbv2Client.send(new DeleteListenerCertificatesCommand({
                                        ListenerArn: listener.ListenerArn,
                                        Certificates: [{ CertificateArn: certArn }]
                                    }));
                                }
                            }
                        }
                    } catch (error) {}

                    const maxRetries = 5;
                    let retryCount = 0;
                    while (retryCount < maxRetries) {
                        try {
                            const certInfo = await acmClient.send(new DescribeCertificateCommand({
                                CertificateArn: certArn
                            }));
                            if (certInfo.Certificate.InUseBy?.length > 0) {
                                break;
                            }
                            await acmClient.send(new DeleteCertificateCommand({
                                CertificateArn: certArn
                            }));
                            break;
                        } catch (error) {
                            if (error.name === "ResourceInUseException" && retryCount < maxRetries - 1) {
                                await new Promise(resolve => setTimeout(resolve, 15000 * (retryCount + 1))); 
                                retryCount++;
                                continue;
                            }
                            break;
                        }
                    }
                } catch (error) {}
            }

            try {
                const projectNames = [
                    projectName,
                    ...(domainName && domainName !== projectName ? [`${projectName}-${domainName}`] : []),
                    ...domains.map(d => d.name.split(".")[0])
                ];
                const listProjectsResp = await codeBuildClient.send(new ListProjectsCommand({}));
                const projectsToDelete = listProjectsResp.projects.filter(p =>
                    projectNames.some(name => p === name || p.startsWith(`${name}-`))
                );
                for (const project of projectsToDelete) {
                    await codeBuildClient.send(new DeleteProjectCommand({ name: project }));
                }
            } catch (error) {}

            const logGroups = [
                `/ecs/${projectName}`,
                `/aws/codebuild/${projectName}`,
                ...(domainName && domainName !== projectName ? [`/ecs/${projectName}-${domainName}`, `/aws/codebuild/${projectName}-${domainName}`] : []),
                ...domains.map(d => `/ecs/${d.name.split(".")[0]}`),
                ...domains.map(d => `/aws/codebuild/${d.name.split(".")[0]}`)
            ];
            for (const logGroup of new Set(logGroups)) {
                try {
                    await cloudWatchLogsClient.send(new DeleteLogGroupCommand({ logGroupName: logGroup }));
                } catch (error) {}
            }

            const targetGroupArns = domains
                .map(d => d.targetGroupArn)
                .filter(arn => arn && arn.match(/:targetgroup\/[a-zA-Z0-9-]+\/[a-f0-9]+$/)); 
            if (domainName && domainName !== projectName) {
                targetGroupArns.push(`arn:aws:elasticloadbalancing:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:targetgroup/${projectName}-${domainName}/default`);
            }
            for (const tgArn of new Set(targetGroupArns)) {
                try {
                    let isUsedByDefaultRule = false;
                    for (const listenerArn of listenerArns) {
                        const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                            ListenerArn: listenerArn
                        }));
                        for (const rule of rulesResp.Rules) {
                            if (rule.IsDefault && rule.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === tgArn)) {
                                isUsedByDefaultRule = true;
                                break;
                            }
                        }
                        if (isUsedByDefaultRule) break;
                    }
                    if (isUsedByDefaultRule) continue;

                    for (const listenerArn of listenerArns) {
                        const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                            ListenerArn: listenerArn
                        }));
                        for (const rule of rulesResp.Rules) {
                            if (!rule.IsDefault && rule.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === tgArn)) {
                                await elbv2Client.send(new DeleteRuleCommand({
                                    RuleArn: rule.RuleArn
                                }));
                            }
                        }
                    }
                    await elbv2Client.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn }));
                } catch (error) {}
            }

            try {
                await pool.query(
                    "DELETE FROM deployment_logs WHERE project_id = $1 AND orgid = $2",
                    [projectID, organizationID]
                );
                await pool.query(
                    "DELETE FROM build_logs WHERE orgid = $1 AND deployment_id IN (SELECT deployment_id FROM deployments WHERE project_id = $2)",
                    [organizationID, projectID]
                );
                await pool.query(
                    "DELETE FROM runtime_logs WHERE orgid = $1 AND deployment_id IN (SELECT deployment_id FROM deployments WHERE project_id = $2)",
                    [organizationID, projectID]
                );
                await pool.query(
                    "DELETE FROM deployments WHERE project_id = $1 AND orgid = $2",
                    [projectID, organizationID]
                );
                await pool.query(
                    "DELETE FROM domains WHERE project_id = $1 AND orgid = $2",
                    [projectID, organizationID]
                );
                await pool.query(
                    "DELETE FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                    [projectID, organizationID, userID]
                );
            } catch (error) {
                throw new Error(`Failed to delete database records: ${error.message}.`);
            }

            try {
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [organizationID, userID, projectID, projectName, "delete", timestamp, "127.0.0.1"]
                );
            } catch (error) {}

            return { message: `Project ${projectName} and all associated resources deleted successfully.` };
        } catch (error) {
            throw new Error(`Failed to delete project: ${error.message}.`);
        }
    }

    async cleanupFailedDeployment({ organizationID, userID, projectID, projectName, domainName, deploymentId, domainId, certificateArn, targetGroupArn }) {
        const timestamp = new Date().toISOString();
        const acmClient = new ACMClient({ region: process.env.AWS_REGION });
        const route53Client = new Route53Client({ region: process.env.AWS_REGION });
        const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const codeBuildClient = new CodeBuildClient({ region: process.env.AWS_REGION });
        const cloudWatchLogsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
        const ecrClient = new ECRClient({ region: process.env.AWS_REGION });
        const ecsClient = new ECSClient({ region: process.env.AWS_REGION });

        try {
            try {
                const serviceName = domainName && domainName !== projectName ? `${projectName}-${domainName}` : projectName;
                const tasksResp = await ecsClient.send(new ListTasksCommand({
                    cluster: process.env.ECS_CLUSTER_ARN,
                    serviceName: serviceName
                }));
                for (const taskArn of tasksResp.taskArns || []) {
                    await ecsClient.send(new StopTaskCommand({
                        cluster: process.env.ECS_CLUSTER_ARN,
                        task: taskArn,
                        reason: `Stopping task for failed deployment ${deploymentId}`
                    }));
                }

                await ecsClient.send(new DeleteServiceCommand({
                    cluster: process.env.ECS_CLUSTER_ARN,
                    service: serviceName,
                    force: true
                }));
                
                const taskDefsResp = await ecsClient.send(new ListTaskDefinitionsCommand({
                    familyPrefix: serviceName
                }));
                for (const taskDefArn of taskDefsResp.taskDefinitionArns || []) {
                    await ecsClient.send(new DeregisterTaskDefinitionCommand({
                        taskDefinition: taskDefArn
                    }));
                }
            } catch (error) {}

            try {
                const domainFqdn = domainName.includes('.') ? domainName : `${domainName}.stackforgeengine.com`;
                const recordName = domainFqdn.endsWith(".") ? domainFqdn : `${domainFqdn}.`;
                const listResp = await route53Client.send(new ListResourceRecordSetsCommand({
                    HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                    StartRecordName: recordName,
                    MaxItems: "10"
                }));
                const records = listResp.ResourceRecordSets.filter(r =>
                    r.Name === recordName &&
                    ["A", "CNAME", "MX", "AAAA"].includes(r.Type)
                );
                if (records.length > 0) {
                    await route53Client.send(new ChangeResourceRecordSetsCommand({
                        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                        ChangeBatch: {
                            Changes: records.map(record => ({
                                Action: "DELETE",
                                ResourceRecordSet: record
                            }))
                        }
                    }));
                }
            } catch (error) {}

            const listenerArns = [process.env.ALB_LISTENER_ARN_HTTP, process.env.ALB_LISTENER_ARN_HTTPS];
            for (const listenerArn of listenerArns) {
                try {
                    const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                        ListenerArn: listenerArn
                    }));
                    for (const rule of rulesResp.Rules) {
                        if (rule.IsDefault) continue;
                        const isProjectRule = rule.Conditions.some(c =>
                            c.Field === "host-header" &&
                            c.Values.includes(`${domainName}.stackforgeengine.com`)
                        ) || rule.Actions.some(a =>
                            a.Type === "forward" && a.TargetGroupArn === targetGroupArn
                        );
                        if (isProjectRule) {
                            await elbv2Client.send(new DeleteRuleCommand({
                                RuleArn: rule.RuleArn
                            }));
                        }
                    }
                } catch (error) {}
            }

            if (certificateArn) {
                try {
                    const listenersResp = await elbv2Client.send(new DescribeListenersCommand({
                        LoadBalancerArn: process.env.LOAD_BALANCER_ARN
                    }));
                    for (const listener of listenersResp.Listeners || []) {
                        const certsResp = await elbv2Client.send(new DescribeListenerCertificatesCommand({
                            ListenerArn: listener.ListenerArn
                        }));
                        if (certsResp.Certificates?.some(c => c.CertificateArn === certificateArn)) {
                            await elbv2Client.send(new DeleteListenerCertificatesCommand({
                                ListenerArn: listener.ListenerArn,
                                Certificates: [{ CertificateArn: certificateArn }]
                            }));
                        }
                    }
                    await acmClient.send(new DeleteCertificateCommand({
                        CertificateArn: certificateArn
                    }));
                } catch (error) {}
            }

            try {
                const projectNames = [projectName, domainName && domainName !== projectName ? `${projectName}-${domainName}` : null].filter(Boolean);
                for (const project of projectNames) {
                    await codeBuildClient.send(new DeleteProjectCommand({ name: project }));
                }
            } catch (error) {}

            const logGroups = [
                `/ecs/${projectName}`,
                `/aws/codebuild/${projectName}`,
                ...(domainName && domainName !== projectName ? [`/ecs/${projectName}-${domainName}`, `/aws/codebuild/${projectName}-${domainName}`] : [])
            ];
            for (const logGroup of logGroups) {
                try {
                    await cloudWatchLogsClient.send(new DeleteLogGroupCommand({ logGroupName: logGroup }));
                } catch (error) {}
            }

            if (targetGroupArn) {
                try {
                    for (const listenerArn of listenerArns) {
                        const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                            ListenerArn: listenerArn
                        }));
                        for (const rule of rulesResp.Rules) {
                            if (!rule.IsDefault && rule.Actions.some(a => a.Type === "forward" && a.TargetGroupArn === targetGroupArn)) {
                                await elbv2Client.send(new DeleteRuleCommand({
                                    RuleArn: rule.RuleArn
                                }));
                            }
                        }
                    }
                    await elbv2Client.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));
                } catch (error) {}
            }

            try {
                await pool.query(
                    "DELETE FROM deployment_logs WHERE deployment_id = $1 AND orgid = $2",
                    [deploymentId, organizationID]
                );
                await pool.query(
                    "DELETE FROM build_logs WHERE deployment_id = $1 AND orgid = $2",
                    [deploymentId, organizationID]
                );
                await pool.query(
                    "DELETE FROM runtime_logs WHERE deployment_id = $1 AND orgid = $2",
                    [deploymentId, organizationID]
                );
                await pool.query(
                    "DELETE FROM deployments WHERE deployment_id = $1 AND orgid = $2",
                    [deploymentId, organizationID]
                );
                if (domainId) {
                    await pool.query(
                        "DELETE FROM domains WHERE domain_id = $1 AND orgid = $2",
                        [domainId, organizationID]
                    );
                }
            } catch (error) {}

            try {
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [organizationID, userID, projectID, projectName, "cleanup_failed", deploymentId, timestamp, "127.0.0.1"]
                );
            } catch (error) {}
        } catch (error) {
            throw new Error(`Cleanup failed: ${error.message}.`);
        }
    }
}

module.exports = new DeployManager();

