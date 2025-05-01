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
    ListResourceRecordSetsCommand
} = require("@aws-sdk/client-route-53");
const {
    ECRClient,
    DescribeRepositoriesCommand,
    CreateRepositoryCommand,
    GetAuthorizationTokenCommand
} = require("@aws-sdk/client-ecr");
const {
    ECSClient,
    RegisterTaskDefinitionCommand,
    DescribeServicesCommand,
    CreateServiceCommand,
    UpdateServiceCommand,
    DeleteServiceCommand,
    DeleteRepositoryCommand,
    DeleteProjectCommand,
    DeleteLogGroupCommand,
    DeleteTargetGroupCommand
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
    AddListenerCertificatesCommand, 
    DeleteRuleCommand, 
    DeleteListenerCertificatesCommand
} = require("@aws-sdk/client-elastic-load-balancing-v2");
const {
    CodeBuildClient,
    StartBuildCommand,
    BatchGetBuildsCommand,
    CreateProjectCommand,
    UpdateProjectCommand,
    DescribeCodeCoveragesCommand
} = require("@aws-sdk/client-codebuild");
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand
} = require("@aws-sdk/client-s3");
const {
    CloudWatchLogsClient,
    GetLogEventsCommand,
    CreateLogStreamCommand,
    CreateLogGroupCommand,
    DescribeLogStreamsCommand
} = require("@aws-sdk/client-cloudwatch-logs");
const { 
    ACMClient, 
    RequestCertificateCommand, 
    DescribeCertificateCommand, 
    AddCertificatesToListenerCommand, 
    DeleteCertificateCommand
} = require("@aws-sdk/client-acm");


const acmClient = new ACMClient({ region: process.env.AWS_REGION });
const route53Client = new Route53Client({ region: process.env.AWS_REGION });
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
            throw new Error(`Failed to fetch latest commit SHA: ${error.message}`);
        }
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
             ORDER BY d.created_at DESC`,
            [organizationID]
        );
        return result.rows;
    }

    async listProjects(organizationID) {
        const result = await pool.query(
            `SELECT * FROM projects
             WHERE orgid = $1
             ORDER BY created_at DESC`,
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
             ORDER BY created_at DESC`,
            [organizationID]
        );
        return result.rows;
    }

    async ensureECRRepo(repoName) {
        try {
            await this.ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
        } catch {
            await this.ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
        }
    }

    async ensureTargetGroup(projectName) {
        try {
            let targetGroupArn;
            try {
                const existingTgResp = await this.elbv2.send(new DescribeTargetGroupsCommand({
                    Names: [projectName]
                }));
                if (existingTgResp.TargetGroups?.length > 0) {
                    targetGroupArn = existingTgResp.TargetGroups[0].TargetGroupArn;
                    return targetGroupArn;
                }
            } catch (error) {
                if (error.name !== "TargetGroupNotFoundException") {
                    throw error;
                }
            }

            let vpcId;
            try {
                const albResp = await this.elbv2.send(new DescribeLoadBalancersCommand({
                    LoadBalancerArns: [process.env.LOAD_BALANCER_ARN]
                }));
                if (albResp.LoadBalancers?.length === 0) {
                    throw new Error(`Load balancer not found: ${process.env.LOAD_BALANCER_ARN}.`);
                }
                vpcId = albResp.LoadBalancers[0].VpcId;
            } catch (error) {
                throw new Error(`Failed to fetch ALB VPC ID: ${error.message}.`);
            }

            const tgResp = await this.elbv2.send(new CreateTargetGroupCommand({
                Name: projectName,
                Protocol: "HTTP",
                Port: 3000,
                VpcId: vpcId,
                TargetType: "ip",
                HealthCheckProtocol: "HTTP",
                HealthCheckPath: "/",
                HealthCheckIntervalSeconds: 30,
                HealthCheckTimeoutSeconds: 5,
                HealthyThresholdCount: 5,
                UnhealthyThresholdCount: 2,
                Matcher: { HttpCode: "200-399" }
            }));

            targetGroupArn = tgResp.TargetGroups[0].TargetGroupArn;

            const tgAttributes = await this.elbv2.send(new DescribeTargetGroupsCommand({
                TargetGroupArns: [targetGroupArn]
            }));
            return targetGroupArn;
        } catch (error) {
            throw new Error(`Failed to ensure target group: ${error.message}.`);
        }
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
             WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3`,
            [deploymentId, organizationID, userID]
        );
        if (result.rows.length === 0) {
            throw new Error("Deployment not found or access denied.");
        }
        return result.rows[0];
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

    async createTaskDef({ projectName, imageUri, envVars }) {
        const logGroupName = `/ecs/${projectName}`;
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
                throw new Error(`IAM permissions  error: ${error.message}. Ensure your IAM user or role has 'iam:PassRole' permission on the role ${process.env.ECS_EXECUTION_ROLE}.`);
            }
            throw error;
        }
    }

    async createOrUpdateService({ projectName, taskDefArn, targetGroupArn }) {
        const {
            ElasticLoadBalancingV2Client,
            DescribeListenersCommand,
            DescribeRulesCommand,
            ModifyRuleCommand,
            CreateRuleCommand,
            AddListenerCertificatesCommand,
            DescribeTargetHealthCommand
        } = require("@aws-sdk/client-elastic-load-balancing-v2");
        const {
            ECSClient,
            DescribeServicesCommand,
            UpdateServiceCommand,
            CreateServiceCommand
        } = require("@aws-sdk/client-ecs");
    
        const serviceParams = {
            cluster: process.env.ECS_CLUSTER,
            serviceName: projectName,
            taskDefinition: taskDefArn,
            desiredCount: 1,
            launchType: "FARGATE",
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: process.env.SUBNET_IDS.split(","),
                    securityGroups: [process.env.ECS_SECURITY_GROUP],
                    assignPublicIp: "ENABLED"
                }
            },
            loadBalancers: [{
                targetGroupArn: targetGroupArn,
                containerName: projectName,
                containerPort: 3000
            }],
            deploymentConfiguration: {
                maximumPercent: 200,
                minimumHealthyPercent: 100
            }
        };
    
        try {
            const domainResult = await pool.query(
                "SELECT certificate_arn FROM domains WHERE project_id = (SELECT project_id FROM projects WHERE name = $1)",
                [projectName]
            );
            const certificateArns = domainResult.rows.map(r => r.certificate_arn).filter(arn => arn);
    
            const listenerResp = await this.elbv2.send(new DescribeListenersCommand({
                ListenerArns: [process.env.ALB_LISTENER_ARN_HTTPS],
            }));
            const listenerCertificates = listenerResp.Listeners[0].Certificates.map(c => c.CertificateArn);
    
            for (const certArn of certificateArns) {
                if (!listenerCertificates.includes(certArn)) {
                    await this.elbv2.send(new AddListenerCertificatesCommand({
                        ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                        Certificates: [{ CertificateArn: certArn }],
                    }));
                }
            }
    
            const baseDomain = `${projectName}.stackforgeengine.com`;
            const wildcardDomain = `*.${projectName}.stackforgeengine.com`;
            const httpsResp = await this.elbv2.send(new DescribeRulesCommand({
                ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS
            }));
            const httpsPrio = httpsResp.Rules.map(r => parseInt(r.Priority)).filter(n => !isNaN(n));
            let nextHttps = httpsPrio.length ? Math.max(...httpsPrio) + 1 : 1;
    
            const existingBaseHttps = httpsResp.Rules.find(rule =>
                rule.Conditions.some(c =>
                    c.Field === "host-header" && c.Values.includes(baseDomain)
                )
            );
            if (existingBaseHttps) {
                await this.elbv2.send(new ModifyRuleCommand({
                    RuleArn: existingBaseHttps.RuleArn,
                    Conditions: [{ Field: "host-header", Values: [baseDomain] }],
                    Actions: [{
                        Type: "forward",
                        TargetGroupArn: targetGroupArn
                    }]
                }));
            } else {
                await this.elbv2.send(new CreateRuleCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                    Conditions: [{ Field: "host-header", Values: [baseDomain] }],
                    Priority: nextHttps,
                    Actions: [{
                        Type: "forward",
                        TargetGroupArn: targetGroupArn
                    }]
                }));
                nextHttps++;
            }
    
            const existingWildcardHttps = httpsResp.Rules.find(rule =>
                rule.Conditions.some(c =>
                    c.Field === "host-header" && c.Values.includes(wildcardDomain)
                )
            );
            if (existingWildcardHttps) {
                await this.elbv2.send(new ModifyRuleCommand({
                    RuleArn: existingWildcardHttps.RuleArn,
                    Conditions: [{ Field: "host-header", Values: [wildcardDomain] }],
                    Actions: [{
                        Type: "forward",
                        TargetGroupArn: targetGroupArn
                    }]
                }));
            } else {
                await this.elbv2.send(new CreateRuleCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                    Conditions: [{ Field: "host-header", Values: [wildcardDomain] }],
                    Priority: nextHttps,
                    Actions: [{
                        Type: "forward",
                        TargetGroupArn: targetGroupArn
                    }]
                }));
            }
    
            const httpResp = await this.elbv2.send(new DescribeRulesCommand({
                ListenerArn: process.env.ALB_LISTENER_ARN_HTTP
            }));
            const httpPrio = httpResp.Rules.map(r => parseInt(r.Priority)).filter(n => !isNaN(n));
            let nextHttp = httpPrio.length ? Math.max(...httpPrio) + 1 : 1;
    
            const existingBaseHttp = httpResp.Rules.find(rule =>
                rule.Conditions.some(c =>
                    c.Field === "host-header" && c.Values.includes(baseDomain)
                )
            );
            if (existingBaseHttp) {
                await this.elbv2.send(new ModifyRuleCommand({
                    RuleArn: existingBaseHttp.RuleArn,
                    Conditions: [{ Field: "host-header", Values: [baseDomain] }],
                    Actions: [{
                        Type: "redirect",
                        RedirectConfig: {
                            Protocol: "HTTPS",
                            Port: "443",
                            StatusCode: "HTTP_301",
                            Host: "#{host}",
                            Path: "/#{path}",
                            Query: "#{query}"
                        },
                        ResponseMetadata: {
                            Headers: {
                                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                                "Pragma": "no-cache"
                            }
                        }
                    }]
                }));
            } else {
                await this.elbv2.send(new CreateRuleCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTP,
                    Conditions: [{ Field: "host-header", Values: [baseDomain] }],
                    Priority: nextHttp,
                    Actions: [{
                        Type: "redirect",
                        RedirectConfig: {
                            Protocol: "HTTPS",
                            Port: "443",
                            StatusCode: "HTTP_301",
                            Host: "#{host}",
                            Path: "/#{path}",
                            Query: "#{query}"
                        },
                        ResponseMetadata: {
                            Headers: {
                                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                                "Pragma": "no-cache"
                            }
                        }
                    }]
                }));
                nextHttp++;
            }
    
            const existingWildcardHttp = httpResp.Rules.find(rule =>
                rule.Conditions.some(c =>
                    c.Field === "host-header" && c.Values.includes(wildcardDomain)
                )
            );
            if (existingWildcardHttp) {
                await this.elbv2.send(new ModifyRuleCommand({
                    RuleArn: existingWildcardHttp.RuleArn,
                    Conditions: [{ Field: "host-header", Values: [wildcardDomain] }],
                    Actions: [{
                        Type: "redirect",
                        RedirectConfig: {
                            Protocol: "HTTPS",
                            Port: "443",
                            StatusCode: "HTTP_301",
                            Host: "#{host}",
                            Path: "/#{path}",
                            Query: "#{query}"
                        },
                        ResponseMetadata: {
                            Headers: {
                                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                                "Pragma": "no-cache"
                            }
                        }
                    }]
                }));
            } else {
                await this.elbv2.send(new CreateRuleCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTP,
                    Conditions: [{ Field: "host-header", Values: [wildcardDomain] }],
                    Priority: nextHttp,
                    Actions: [{
                        Type: "redirect",
                        RedirectConfig: {
                            Protocol: "HTTPS",
                            Port: "443",
                            StatusCode: "HTTP_301",
                            Host: "#{host}",
                            Path: "/#{path}",
                            Query: "#{query}"
                        },
                        ResponseMetadata: {
                            Headers: {
                                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                                "Pragma": "no-cache"
                            }
                        }
                    }]
                }));
            }
    
            const describe = await this.ecs.send(new DescribeServicesCommand({
                cluster: process.env.ECS_CLUSTER,
                services: [projectName]
            }));
            const exists = describe.services?.length > 0 && describe.services[0].status !== "INACTIVE";
            if (exists) {
                await this.ecs.send(new UpdateServiceCommand({
                    cluster: process.env.ECS_CLUSTER,
                    service: projectName,
                    taskDefinition: taskDefArn,
                    forceNewDeployment: true
                }));
            } else {
                await this.ecs.send(new CreateServiceCommand({
                    ...serviceParams,
                    serviceName: projectName
                }));
            }
    
            const healthResp = await this.elbv2.send(new DescribeTargetHealthCommand({
                TargetGroupArn: targetGroupArn
            }));
            if (healthResp.TargetHealthDescriptions.length === 0 || 
                !healthResp.TargetHealthDescriptions.some(th => th.TargetHealth.State === "healthy")) {
            }
    
        } catch (error) {
            throw new Error(`Failed to create/update ECS service: ${error.message}.`);
        }
    }
    
    async createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, outputDirectory, githubAccessToken }) {
        if (!repository || typeof repository !== "string" || repository.trim() === "") {
            throw new Error("Invalid repository: repository parameter is required and must be a non-empty string.");
        }
        if (!githubAccessToken || typeof githubAccessToken !== "string" || githubAccessToken.trim() === "") {
            throw new Error("Invalid GitHub access token: token is required and must be a non-empty string.");
        }
        await this.validateGitHubToken(githubAccessToken, repository);
        let repoUrl;
        if (/^https?:\/\//i.test(repository) || /^git@/i.test(repository)) {
            repoUrl = repository;
        } else {
            const cleanRepo = repository.trim().replace(/^\/+|\/+$/g, "");
            repoUrl = `https://github.com/${cleanRepo}.git`;
        }
        const rootDir = rootDirectory || ".";
        const buildspec = {
            version: "0.2",
            phases: {
                install: {
                    "runtime-versions": { nodejs: "20" },
                    commands: [
                        "echo \"Install phase: nothing to do here\""
                    ]
                },
                pre_build: {
                    commands: [
                        "echo \"Starting pre_build phase\"",
                        "echo \"Configuring Git credentials\"",
                        "git config --global credential.helper '!f() { echo username=x-oauth-basic; echo password=$GITHUB_TOKEN; }; f'",
                        "echo \"Cloning repository into $CODEBUILD_SRC_DIR\"",
                        `git clone --branch $REPO_BRANCH $REPO_URL $CODEBUILD_SRC_DIR || { echo \"Git clone failed: $?\"; exit 1; }`,
                        "echo \"Listing cloned files\"",
                        `ls -la $CODEBUILD_SRC_DIR`,
                        "echo \"Entering root directory: $ROOT_DIRECTORY\"",
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        "echo \"Listing files in $ROOT_DIRECTORY\"",
                        `ls -la $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        "echo \"Installing dependencies\"",
                        installCommand || "npm install"
                    ]
                },
                build: {
                    commands: [
                        "echo \"Starting build phase\"",
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        "echo \"Current directory: $(pwd)\"",
                        "echo \"Listing files before build\"",
                        "ls -la",
                        "echo \"No build step required for Node.js app\""
                    ]
                },
                post_build: {
                    commands: [
                        "echo \"Starting post_build phase\"",
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        "echo \"Current directory: $(pwd)\"",
                        "echo \"Listing files before Docker build\"",
                        "ls -la",
                        "echo \"Building Docker image\"",
                        "echo \"FROM node:20\" > Dockerfile",
                        "echo \"WORKDIR /app\" >> Dockerfile",
                        "echo \"COPY package*.json ./\" >> Dockerfile",
                        "echo \"RUN npm install\" >> Dockerfile",
                        "echo \"COPY api/ ./api/\" >> Dockerfile",
                        "echo \"CMD [\\\"node\\\", \\\"api/index.js\\\"]\" >> Dockerfile",
                        "echo \"Listing files in current directory after Dockerfile creation\"",
                        "ls -la",
                        "cat Dockerfile",
                        "docker build -t $REPO_URI:latest .",
                        "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO_URI",
                        "docker push $REPO_URI:latest"
                    ]
                }
            },
            artifacts: {
                files: ["**/*"],
                "discard-paths": "yes"
            }
        };

        const envVariables = [
            { name: "ROOT_DIRECTORY", value: rootDir, type: "PLAINTEXT" },
            { name: "INSTALL_COMMAND", value: installCommand || "npm install", type: "PLAINTEXT" },
            { name: "BUILD_COMMAND", value: buildCommand || "", type: "PLAINTEXT" },
            { name: "OUTPUT_DIRECTORY", value: outputDirectory || "", type: "PLAINTEXT" },
            { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
            { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
            { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
            { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
            { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" }
        ];
        const projectParams = {
            name: projectName,
            source: { type: "NO_SOURCE", buildspec: JSON.stringify(buildspec) },
            artifacts: { type: "NO_ARTIFACTS" },
            environment: {
                type: "LINUX_CONTAINER",
                image: "aws/codebuild/standard:7.0",
                computeType: "BUILD_GENERAL1_SMALL",
                environmentVariables: envVariables,
                privilegedMode: true
            },
            serviceRole: process.env.CODEBUILD_ROLE_ARN,
            logsConfig: {
                cloudWatchLogs: {
                    status: "ENABLED",
                    groupName: `/aws/codebuild/${projectName}`
                }
            }
        };
        try {
            await codeBuildClient.send(new CreateProjectCommand(projectParams));
        } catch (error) {
            if (error.name === "ResourceAlreadyExistsException") {
                await codeBuildClient.send(new UpdateProjectCommand(projectParams));
            } else {
                throw new Error(`Failed to create CodeBuild project: ${error.message}.`);
            }
        }
    }

    async startCodeBuild({ projectName, repository, branch, logDir, githubAccessToken }) {
        const logGroupName = `/aws/codebuild/${projectName}`;
        const logStreamName = `build-${uuidv4()}`;
        const repoUrl = /^https?:\/\//i.test(repository) || /^git@/i.test(repository)
            ? repository
            : `https://github.com/${repository}.git`;
        if (!githubAccessToken) {
            throw new Error("GitHub access token is required for CodeBuild.");
        }
        await this.validateGitHubToken(githubAccessToken, repository);
        try {
            await cloudWatchLogsClient.send(new CreateLogStreamCommand({
                logGroupName,
                logStreamName
            }));
        } catch (error) { }
        const build = await codeBuildClient.send(new StartBuildCommand({
            projectName,
            environmentVariablesOverride: [
                { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
                { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
                { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
                { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
                { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" }
            ]
        }));
        const buildId = build.build.id;
        const logFile = path.join(logDir, `codebuild-${buildId.replace(/:/g, "-")}.log`);
        fs.writeFileSync(logFile, "");
        let nextToken;
        let buildStatus = "IN_PROGRESS";
        while (buildStatus === "IN_PROGRESS") {
            const logs = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                logGroupName,
                logStreamName: buildId.split(":")[1],
                nextToken,
                startFromHead: true
            }));
            for (const event of logs.events) {
                fs.appendFileSync(logFile, event.message + "\n");
            }
            nextToken = logs.nextForwardToken;
            const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
            buildStatus = buildInfo.builds[0].buildStatus;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (buildStatus !== "SUCCEEDED") {
            const finalLogs = fs.readFileSync(logFile, "utf-8");
            throw new Error(`Build failed: ${finalLogs}.`);
        }
        const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:latest`;
        return { imageUri, logFile };
    }

    async streamCodeBuild({ projectName, repository, branch, githubAccessToken }, onChunk) {
        if (typeof onChunk !== "function") {
            throw new Error(`streamCodeBuild: onChunk is not a function, received: ${typeof onChunk}.`);
        }
        if (!githubAccessToken) {
            onChunk("GitHub access token is required for CodeBuild\n");
            throw new Error("GitHub access token is required for CodeBuild.");
        }
        await this.validateGitHubToken(githubAccessToken, repository);
        const logGroupName = `/aws/codebuild/${projectName}`;
        const repoUrl = /^https?:\/\//i.test(repository) || /^git@/i.test(repository)
            ? repository
            : `https://github.com/${repository}.git`;
        onChunk(`Starting CodeBuild for project: ${projectName}, repository: ${repoUrl}, branch: ${branch}\n`);
        const logStreamName = `build-${uuidv4()}`;
        try {
            await cloudWatchLogsClient.send(new CreateLogStreamCommand({
                logGroupName,
                logStreamName
            }));
            onChunk(`Created CloudWatch log stream: ${logStreamName}\n`);
        } catch (error) {
            onChunk(`Error creating log stream: ${error.message}\n`);
        }
        let build;
        try {
            build = await codeBuildClient.send(new StartBuildCommand({
                projectName,
                environmentVariablesOverride: [
                    { name: "REPO_URI", value: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`, type: "PLAINTEXT" },
                    { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
                    { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
                    { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
                    { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" }
                ]
            }));
            onChunk(`CodeBuild started with build ID: ${build.build.id}\n`);
        } catch (error) {
            onChunk(`Failed to start CodeBuild: ${error.message}\n`);
            throw new Error(`CodeBuild start failed: ${error.message}.`);
        }
        const buildId = build.build.id;
        const logStreamNameUsed = build.build.logs?.cloudWatchLogs?.logStreamName || buildId.split(":")[1];
        onChunk(`Using log stream name: ${logStreamNameUsed}\n`);
        let nextToken;
        let buildStatus = "IN_PROGRESS";
        const maxRetries = 24;
        let retryCount = 0;
        const timeout = 15 * 60 * 1000;
        const startTime = Date.now();
        let lastLogEvent = "";
        while (buildStatus === "IN_PROGRESS") {
            if (Date.now() - startTime > timeout) {
                onChunk(`Build process timed out after ${timeout / 1000 / 60} minutes\n`);
                throw new Error("Build process timed out.");
            }
            try {
                const logs = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                    logGroupName,
                    logStreamName: logStreamNameUsed,
                    nextToken,
                    startFromHead: true
                }));
                onChunk(`Fetched ${logs.events.length} log events\n`);
                for (const event of logs.events) {
                    onChunk(event.message + "\n");
                    lastLogEvent = event.message;
                }
                nextToken = logs.nextForwardToken;
                retryCount = 0;
            } catch (error) {
                if (error.name === "ResourceNotFoundException") {
                    retryCount++;
                    onChunk(`Log stream not yet available, retrying (${retryCount}/${maxRetries}),  error: ${error.message}\n`);
                    if (retryCount >= maxRetries) {
                        onChunk(`Max retries reached for log stream\n`);
                        throw new Error(`Log stream not found after ${maxRetries} retries.`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                onChunk(`Error fetching logs: ${error.message}\n`);
                throw error;
            }
            try {
                const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
                buildStatus = buildInfo.builds[0].buildStatus;
                const buildPhase = buildInfo.builds[0].currentPhase || "UNKNOWN";
                onChunk(`Build status: ${buildStatus}, phase: ${buildPhase}\n`);
                if (buildStatus !== "IN_PROGRESS" && buildStatus !== "SUCCEEDED") {
                    const failureReason = buildInfo.builds[0].buildStatusDetails || `Unknown failure: ${lastLogEvent}`;
                    onChunk(`Build failed with status: ${buildStatus}, reason: ${failureReason}\n`);
                    throw new Error(`Build failed with status: ${buildStatus}, reason: ${lastLogEvent}.`);
                }
            } catch (error) {
                onChunk(`Error checking build status: ${error.message}\n`);
                throw  error;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (buildStatus !== "SUCCEEDED") {
            onChunk(`Build did not succeed, final status: ${buildStatus}\n`);
            throw new Error(`Build failed with status: ${buildStatus}, reason: ${lastLogEvent}.`);
        }
        const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:latest`;
        onChunk(`Build succeeded, image URI: ${imageUri}\n`);
        return imageUri;
    }
      
    async recordBuildLogCombined(orgid, username, deploymentId, logDir, streamBuffer = "") {
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

    async recordRuntimeLogs(orgid, username, deploymentId, projectName) {
        const logGroupName = `/ecs/${projectName}`;

        let deploymentUrl;
        try {
            const deploymentResult = await pool.query(
                `SELECT url FROM deployments WHERE deployment_id = $1 AND orgid = $2 AND username = $3`,
                [deploymentId, orgid, username]
            );
            if (deploymentResult.rows.length === 0) {
                throw new Error("Deployment not found.");
            }
            deploymentUrl = deploymentResult.rows[0].url;
        } catch (error) {
            deploymentUrl = `https://${projectName}.stackforgeengine.com`;
        }

        let hostname;
        try {
            const urlObj = new URL(deploymentUrl);
            hostname = urlObj.hostname;
        } catch (error) {
            hostname = `${projectName}.stackforgeengine.com`;
        }

        let httpStatus = null;
        try {
            const response = await axios.get(deploymentUrl, { timeout: 5000 });
            httpStatus = response.status;
        } catch (error) {
            httpStatus =  error.response?.status || 503;
        }

        const resp = await cloudWatchLogsClient.send(new DescribeLogStreamsCommand({
            logGroupName,
            logStreamNamePrefix: "ecs"
        }));

        for (const ls of resp.logStreams) {
            let nextToken;
            let allMessages = "";
            let events;
            do {
                const eventsResp = await cloudWatchLogsClient.send(new GetLogEventsCommand({
                    logGroupName,
                    logStreamName: ls.logStreamName,
                    nextToken,
                    startFromHead: true
                }));
                events = eventsResp.events;
                for (const event of events) {
                    allMessages += event.message + "\n";
                }
                nextToken = eventsResp.nextForwardToken;
            } while (events.length);

            const rawPath = `${logGroupName}/${ls.logStreamName}`;
            const sanitizedPath = rawPath
                .replace(/[^a-zA-Z0-9\/_-]/g, '_')
                .replace(/\/+/g, '/')
                .replace(/^\/+|\/+$/g, '');

            await pool.query(
                `INSERT INTO runtime_logs 
                 (orgid, username, deployment_id, build_log_id, timestamp, runtime_path, runtime_messages, status, hostname) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    orgid,
                    username,
                    deploymentId,
                    uuidv4(),
                    new Date().toISOString(),
                    sanitizedPath,
                    allMessages,
                    httpStatus,
                    hostname
                ]
            );
        }
    }

    async cloneAndBuild({
        repository,
        branch,
        rootDirectory,
        outputDirectory,
        buildCommand,
        installCommand,
        envVars,
        projectName
    }) {
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        const tokenResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", ["piacobelli"]);
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, githubAccessToken });
        const { logFile } = await this.startCodeBuild({ projectName, repository, branch, logDir, githubAccessToken });
        return logDir;
    }

    async cloneAndBuildStream(
        { repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName },
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
            await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, githubAccessToken });
            onData(`CodeBuild project configured for ${projectName}\n`);
            const imageUri = await this.streamCodeBuild({ projectName, repository, branch, githubAccessToken }, onData);
            onData(`Build completed successfully. Image pushed to ${imageUri}\n`);
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
        envVars
    }) {
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        await this.ensureECRRepo(projectName);
        const tokenResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            throw new Error("GitHub account not connected.");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, githubAccessToken });
        const { imageUri, logFile } = await this.startCodeBuild({ projectName, repository, branch, logDir, githubAccessToken });
        const taskDefArn = await this.createTaskDef({ projectName, imageUri, envVars });
        const targetGroupArn = await this.ensureTargetGroup(projectName);
        await this.createOrUpdateService({ projectName, taskDefArn, domainName, targetGroupArn });
        return taskDefArn;
    }

    async launchWebsite({
        userID,
        organizationID,
        projectName,
        domainName,
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
        const url = `https://${domainName}.stackforgeengine.com`;
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        let projectID;
        let isNewProject = false;
        let domainId;
    
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
            await pool.query(
                `UPDATE projects
                 SET previous_deployment = current_deployment,
                     current_deployment = $1,
                     updated_at = $2
                 WHERE project_id = $3`,
                [deploymentId, timestamp, projectID]
            );
        } else {
            isNewProject = true;
            projectID = uuidv4();
            domainId = uuidv4();
            await pool.query(
                `INSERT INTO domains 
                 (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    organizationID,
                    userID,
                    domainId,
                    domainName,
                    projectID,
                    userID,
                    timestamp,
                    timestamp,
                    "production",
                    deploymentId 
                ]
            );
        }
        if (!isNewProject) {
            const existingDomainRes = await pool.query(
                "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
                [projectID, domainName]
            );
            if (existingDomainRes.rows.length > 0) {
                domainId = existingDomainRes.rows[0].domain_id;
                await pool.query(
                    `UPDATE domains
                     SET updated_at = $1, deployment_id = $2
                     WHERE domain_id = $3`,
                    [timestamp, deploymentId, domainId] 
                );
            } else {
                domainId = uuidv4();
                await pool.query(
                    `INSERT INTO domains 
                     (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        organizationID,
                        userID,
                        domainId,
                        domainName,
                        projectID,
                        userID,
                        timestamp,
                        timestamp,
                        "production",
                        deploymentId 
                    ]
                );
            }
            await pool.query(
                "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                ["inactive", timestamp, projectID, "active"]
            );
            await pool.query(
                `INSERT INTO deployments 
                 (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    organizationID,
                    userID,
                    deploymentId,
                    projectID,
                    domainId,
                    "building",
                    url,
                    template || "default",
                    timestamp,
                    timestamp,
                    timestamp,
                    null,
                    commitSha,
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
                    "127.0.0.1",
                ]
            );
        }
        try {
            const domainResult = await pool.query(
                "SELECT domain_name FROM domains WHERE project_id = $1 AND orgid = $2",
                [projectID, organizationID]
            );
            const subdomains = domainResult.rows.map((row) => row.domain_name.split(".")[0]);
            await this.updateDNSRecord(projectName, subdomains);
        } catch (error) {
            fs.appendFileSync(
                path.join(logDir, "error.log"),
                `DNS update failed: ${error.message}\n`
            );
            throw error;
        }
        try {
            const fqdn = `${domainName}.stackforgeengine.com`;
            const records = [];
            try {
                const a = await dns.resolve4(fqdn);
                if (a.length) records.push({ type: "A", name: "@", value: a[0] });
            } catch (error) {}
            try {
                const aaaa = await dns.resolve6(fqdn);
                if (aaaa.length) records.push({ type: "AAAA", name: "@", value: aaaa[0] });
            } catch (error) {}
            try {
                const cname = await dns.resolveCname(fqdn);
                if (cname.length) records.push({ type: "CNAME", name: "@", value: cname[0] });
            } catch (error) {}
            try {
                const mx = await dns.resolveMx(fqdn);
                if (mx.length)
                    records.push({
                        type: "MX",
                        name: "@",
                        value: mx.map((r) => `${r.priority} ${r.exchange}`).join(", "),
                    });
            } catch (error) {}
    
            await pool.query(
                `UPDATE domains SET dns_records = $1 WHERE domain_id = $2`,
                [JSON.stringify(records), domainId]
            );
        } catch (error) {}
        try {
            const taskDefArn = await this.launchContainer({
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
            });
            if (isNewProject) {
                await pool.query(
                    `INSERT INTO projects 
                     (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image) 
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        null,
                        branch,
                        teamName,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars),
                        userID,
                        timestamp,
                        timestamp,
                        url,
                        repository,
                        null,
                        deploymentId,
                        null,
                    ]
                );
                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [
                        organizationID,
                        userID,
                        deploymentId,
                        projectID,
                        domainId,
                        "active",
                        url,
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArn,
                        commitSha,
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
                        "127.0.0.1",
                    ]
                );
            } else {
                const now = new Date().toISOString();
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2, last_deployed_at = $2, task_def_arn = $3, commit_sha = $4 WHERE deployment_id = $5",
                    ["active", now, taskDefArn, commitSha, deploymentId]
                );
            }
            await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir);
            await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            return { url, deploymentId, logPath: logDir, taskDefArn };
        } catch (error) {
            if (!isNewProject) {
                const now = new Date().toISOString();
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE deployment_id = $3",
                    ["failed", now, deploymentId]
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
                        "build_failed",
                        deploymentId,
                        now,
                        "127.0.0.1",
                    ]
                );
                await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir);
                await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            }
            throw error;
        }
    }

    async launchWebsiteStream(
        {
            userID,
            organizationID,
            projectName,
            domainName,
            template,
            repository,
            branch,
            teamName,
            rootDirectory,
            outputDirectory,
            buildCommand,
            installCommand,
            envVars,
        },
        onData
    ) {
        if (typeof onData !== "function") {
            throw new Error(`launchWebsiteStream: onData is not a function, received: ${typeof onData}.`);
        }
        onData(`Starting deployment for project: ${projectName}\n`);
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const url = `https://${domainName}.stackforgeengine.com`;
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
        let domainId;
    
        const tokenResult = await pool.query(
            "SELECT github_access_token FROM users WHERE username = $1",
            [userID]
        );
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            onData(`No GitHub access token found for user: ${userID}\n`);
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
            const existingProjRes = await pool.query(
                "SELECT project_id FROM projects WHERE orgid = $1 AND username = $2 AND name = $3",
                [organizationID, userID, projectName]
            );
            if (existingProjRes.rows.length > 0) {
                projectID = existingProjRes.rows[0].project_id;
                onData(`Existing project found, ID: ${projectID}\n`);
                await pool.query(
                    `UPDATE projects
                     SET previous_deployment = current_deployment,
                         current_deployment = $1,
                         updated_at = $2
                     WHERE project_id = $3`,
                    [deploymentId, timestamp, projectID]
                );
                onData(`Updated project with deployment ID: ${deploymentId}\n`);
            } else {
                isNewProject = true;
                projectID = uuidv4();
                domainId = uuidv4();
                onData(`New project created, ID: ${projectID}, Domain ID: ${domainId}\n`);
            }
        } catch (error) {
            onData(`Error checking project: ${error.message}\n`);
            throw new Error(`Project check failed: ${error.message}.`);
        }
        if (!isNewProject) {
            try {
                onData(`Checking for existing domain: ${domainName}\n`);
                const existingDomainRes = await pool.query(
                    "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
                    [projectID, domainName]
                );
                if (existingDomainRes.rows.length > 0) {
                    domainId = existingDomainRes.rows[0].domain_id;
                    onData(`Existing domain found, ID: ${domainId}\n`);
                    await pool.query(
                        `UPDATE domains
                         SET updated_at = $1, deployment_id = $2
                         WHERE domain_id = $3`,
                        [timestamp, deploymentId, domainId] 
                    );
                    onData(`Updated domain timestamp and deployment_id\n`);
                } else {
                    domainId = uuidv4();
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                        [
                            organizationID,
                            userID,
                            domainId,
                            domainName,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            true,
                            deploymentId 
                        ]
                    );
                    onData(`Created new domain, ID: ${domainId}\n`);
                }
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                    ["inactive", timestamp, projectID, "active"]
                );
                onData(`Marked previous deployments as inactive\n`);
                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [
                        organizationID,
                        userID,
                        deploymentId,
                        projectID,
                        domainId,
                        "building",
                        url,
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        null,
                        commitSha,
                    ]
                );
                onData(`Inserted new deployment record, ID: ${deploymentId}\n`);
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
                        "127.0.0.1",
                    ]
                );
                onData(`Logged deployment action: update\n`);
            } catch (error) {
                onData(`Error managing domain/deployment records: ${error.message}\n`);
                throw new Error(`Domain/deployment record management failed: ${error.message}.`);
            }
        }
        let streamBuffer = "";
        try {
            onData(`Updating DNS records for project ${projectName}\n`);
            const domainResult = await pool.query(
                "SELECT domain_name FROM domains WHERE project_id = $1",
                [projectID]
            );
            const subdomains = domainResult.rows.map((row) => row.domain_name.split(".")[0]);
            await this.updateDNSRecord(projectName, subdomains);
            onData("DNS records updated successfully\n");
            onData(`Ensuring ECR repository for ${projectName}\n`);
            await this.ensureECRRepo(projectName);
            onData(`ECR repository ensured for ${projectName}\n`);
            onData(`Creating/updating CodeBuild project for ${projectName}\n`);
            await this.createCodeBuildProject({
                projectName,
                repository,
                branch,
                rootDirectory,
                installCommand,
                buildCommand,
                outputDirectory,
                githubAccessToken,
            });
            onData(`CodeBuild project created/updated for ${projectName}\n`);
            onData(`Starting CodeBuild process\n`);
            const capturingOnData = (chunk) => {
                streamBuffer += chunk;
                onData(chunk);
            };
            onData(`Preparing to start CodeBuild streaming\n`);
            const imageUri = await this.streamCodeBuild(
                { projectName, repository, branch, githubAccessToken },
                capturingOnData
            );
            onData(`Docker image pushed to ${imageUri}\n`);
            onData(`Registering ECS task definition\n`);
            const taskDefArn = await this.createTaskDef({ projectName, imageUri, envVars });
            onData(`ECS task definition registered: ${taskDefArn}\n`);
            onData(`Ensuring target group\n`);
            const targetGroupArn = await this.ensureTargetGroup(projectName);
            onData(`Target group ensured: ${targetGroupArn}\n`);
            onData(`Creating/updating ECS service\n`);
            await this.createOrUpdateService({
                projectName,
                taskDefArn,
                targetGroupArn,
            });
            onData(`ECS service created/updated for ${projectName}\n`);
    
            onData(`Checking ECS service status\n`);
            try {
                const serviceDesc = await this.ecs.send(
                    new DescribeServicesCommand({
                        cluster: process.env.ECS_CLUSTER,
                        services: [projectName],
                    })
                );
                const service = serviceDesc.services?.[0];
                if (service) {
                    onData(
                        `Service Status: ${service.status}, Desired Count: ${service.desiredCount}, Running Count: ${service.runningCount}\n`
                    );
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
    
            onData(`Checking load balancer listener rules\n`);
            try {
                const listeners = await this.elbv2.send(
                    new DescribeListenersCommand({
                        LoadBalancerArn: process.env.LOAD_BALANCER_ARN,
                    })
                );
                const listenerArns = [
                    { arn: process.env.ALB_LISTENER_ARN_HTTP, protocol: "HTTP", port: "80" },
                    { arn: process.env.ALB_LISTENER_ARN_HTTPS, protocol: "HTTPS", port: "443" },
                ];
    
                for (const listener of listenerArns) {
                    const rules = await this.elbv2.send(
                        new DescribeRulesCommand({
                            ListenerArn: listener.arn,
                        })
                    );
                    const relevantRules = rules.Rules?.filter((rule) =>
                        rule.Conditions.some((cond) =>
                            cond.Field === "host-header" &&
                            cond.Values.some((val) => val.includes(`${projectName}.stackforgeengine.com`))
                        )
                    );
                    if (relevantRules?.length > 0) {
                        onData(
                            `Listener ${listener.protocol}:${listener.port} rules for ${projectName}.stackforgeengine.com:\n`
                        );
                        relevantRules.forEach((rule) => {
                            onData(`Rule Priority: ${rule.Priority}, Actions: ${JSON.stringify(rule.Actions)}\n`);
                        });
                    } else {
                        onData(
                            `No listener rules found for ${projectName}.stackforgeengine.com on ${listener.protocol}:${listener.port}\n`
                        );
                    }
                }
            } catch (error) {
                onData(`Error checking listener rules: ${error.message}\n`);
            }
    
            onData(`Checking target group health and task network interfaces\n`);
            try {
                const targetGroupResp = await this.elbv2.send(
                    new DescribeTargetGroupsCommand({ Names: [projectName] })
                );
                const targetGroupArn = targetGroupResp.TargetGroups?.[0]?.TargetGroupArn;
                if (targetGroupArn) {
                    const healthResp = await this.elbv2.send(
                        new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn })
                    );
                    if (healthResp.TargetHealthDescriptions?.length > 0) {
                        healthResp.TargetHealthDescriptions.forEach((th) => {
                            onData(
                                `Target: ${th.Target.Id}:${th.Target.Port}, Health: ${th.TargetHealth.State}, Reason: ${th.TargetHealth.Reason || "N/A"}, Description: ${th.TargetHealth.Description || "N/A"}\n`
                            );
                        });
                    } else {
                        onData(`No registered targets found for target group ${projectName}\n`);
                    }
                } else {
                    onData(`Target group for ${projectName} not found\n`);
                }
    
                const serviceDesc = await this.ecs.send(
                    new DescribeServicesCommand({
                        cluster: process.env.ECS_CLUSTER,
                        services: [projectName],
                    })
                );
                const service = serviceDesc.services?.[0];
                if (service?.tasks?.length > 0) {
                    const taskResp = await this.ecs.send(
                        new DescribeTasksCommand({
                            cluster: process.env.ECS_CLUSTER,
                            tasks: [service.tasks[0].taskArn],
                        })
                    );
                    const task = taskResp.tasks?.[0];
                    if (task) {
                        const networkInterface = task.attachments
                            ?.find((a) => a.type === "ElasticNetworkInterface")
                            ?.details?.find((d) => d.name === "privateIPv4Address");
                        onData(`Task Network Interface: Private IP ${networkInterface?.value || "N/A"}\n`);
                    }
                }
            } catch (error) {
                onData(`Error checking target group health or task network interfaces: ${error.message}\n`);
            }
    
            if (isNewProject) {
                onData(`Creating new project record\n`);
                await pool.query(
                    `INSERT INTO projects 
                     (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        null,
                        branch,
                        teamName,
                        rootDirectory,
                        outputDirectory,
                        buildCommand,
                        installCommand,
                        JSON.stringify(envVars),
                        userID,
                        timestamp,
                        timestamp,
                        url,
                        repository,
                        null,
                        deploymentId,
                        null,
                    ]
                );
                onData(`Project record created\n`);
    
                await pool.query(
                    `INSERT INTO domains 
                     (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                        organizationID,
                        userID,
                        domainId,
                        domainName,
                        projectID,
                        userID,
                        timestamp,
                        timestamp,
                        "production",
                        true,
                        deploymentId 
                    ]
                );
    
                onData(`Domain record created\n`);
    
                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [
                        organizationID,
                        userID,
                        deploymentId,
                        projectID,
                        domainId,
                        "active",
                        url,
                        template || "default",
                        timestamp,
                        timestamp,
                        timestamp,
                        taskDefArn,
                        commitSha,
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
                        "127.0.0.1",
                    ]
                );
                onData(`Deployment log created\n`);
            } else {
                const now = new Date().toISOString();
                onData(`Updating deployment status to active\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2, last_deployed_at = $2, task_def_arn = $3, commit_sha = $4 WHERE deployment_id = $5",
                    ["active", now, taskDefArn, commitSha, deploymentId]
                );
                onData(`Deployment status updated\n`);
            }
            onData(`Recording build logs\n`);
            await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir, streamBuffer);
            onData(`Build logs recorded\n`);
            onData(`Recording runtime logs\n`);
            await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            onData(`Runtime logs recorded\n`);
            return { url, deploymentId, logPath: logDir, taskDefArn };
        } catch (error) {
            onData(`Deployment failed: ${error.message}\n`);
            if (!isNewProject) {
                const now = new Date().toISOString();
                onData(`Marking deployment as failed\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE deployment_id = $3",
                    ["failed", now, deploymentId]
                );
                onData(`Logging deployment failure\n`);
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        "build_failed",
                        deploymentId,
                        now,
                        "127.0.0.1",
                    ]
                );
                onData(`Recording failed build logs\n`);
                await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir, streamBuffer);
                onData(`Recording failed runtime logs\n`);
                await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
                onData(`Failed runtime logs recorded\n`);
            }
            throw error;
        }
    }

    async updateDNSRecord(projectName, subdomains) {
        const { Resolver } = require('dns').promises;
    
        if (!projectName || projectName.trim() === "") {
            throw new Error("Project name cannot be empty.");
        }
        const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
        const albZoneId     = process.env.LOAD_BALANCER_ZONE_ID;
        const loadBalancerDNS = process.env.LOAD_BALANCER_DNS;
        if (!hostedZoneId || !albZoneId || !loadBalancerDNS) {
            throw new Error("Route53 DNS configuration missing.");
        }
    
        projectName = projectName.toLowerCase();
    
        const fqdnList = [`${projectName}.stackforgeengine.com`];
        if (Array.isArray(subdomains)) {
            subdomains.forEach(sub => {
                const clean = sub.trim().toLowerCase();
                if (clean && clean !== projectName)
                    fqdnList.push(`${clean}.${projectName}.stackforgeengine.com`);
            });
        }
    
        const changes = [];
    
        for (const domain of fqdnList) {
            const recordName = domain.endsWith('.') ? domain : `${domain}.`;
            try {
                const listResp = await route53Client.send(new ListResourceRecordSetsCommand({
                    HostedZoneId: hostedZoneId,
                    StartRecordName: recordName,
                    MaxItems: "10",
                }));
                listResp.ResourceRecordSets
                    .filter(r => r.Name.replace(/\.$/,"") === recordName.replace(/\.$/,""))
                    .forEach(existing => {
                        changes.push({ Action: "DELETE", ResourceRecordSet: existing });
                    });
            } catch (error) {}
    
            const label = domain.split('.')[0];
            if (label === projectName) {
                changes.push({
                    Action: "UPSERT",
                    ResourceRecordSet: {
                        Name: recordName,
                        Type: "A",
                        AliasTarget: {
                            HostedZoneId: albZoneId,
                            DNSName: loadBalancerDNS.endsWith('.') ? loadBalancerDNS : `${loadBalancerDNS}.`,
                            EvaluateTargetHealth: false
                        }
                    }
                });
            } else {
                changes.push({
                    Action: "UPSERT",
                    ResourceRecordSet: {
                        Name: recordName,
                        Type: "CNAME",
                        TTL: 30,
                        ResourceRecords: [{ Value: `${projectName}.stackforgeengine.com.` }]
                    }
                });
            }
        }
    
        if (changes.length === 0) return;
    
        await route53Client.send(new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            ChangeBatch: { Changes: changes }
        }));
    
        const resolver = new Resolver();
        resolver.setServers(['8.8.8.8','8.8.4.4']);
        for (const domain of fqdnList) {
            let tries = 0, ok = false;
            while (tries < 10 && !ok) {
                try {
                    if (domain === `${projectName}.stackforgeengine.com`) {
                        const a = await resolver.resolve4(domain);
                        ok = a.length > 0;
                    } else {
                        const c = await resolver.resolveCname(domain);
                        ok = c.includes(`${projectName}.stackforgeengine.com`);
                    }
                } catch {}
                if (!ok) {
                    tries++;
                    await new Promise(r=>setTimeout(r,15000));
                }
            }
        }
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
        const { DeleteRepositoryCommand } = require("@aws-sdk/client-ecr");
        const { DeleteProjectCommand } = require("@aws-sdk/client-codebuild");
        const { DeleteLogGroupCommand } = require("@aws-sdk/client-cloudwatch-logs");
        const { DeleteTargetGroupCommand } = require("@aws-sdk/client-elastic-load-balancing-v2");
    
        const timestamp = new Date().toISOString();
        const acmClient = new ACMClient({ region: process.env.AWS_REGION });
        const route53Client = new Route53Client({ region: process.env.AWS_REGION });
        const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const codeBuildClient = new CodeBuildClient({ region: process.env.AWS_REGION });
        const cloudWatchLogsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
        const ecrClient = new ECRClient({ region: process.env.AWS_REGION });
    
        try {
            const projectResult = await pool.query(
                "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                [projectID, organizationID, userID]
            );
            if (projectResult.rows.length === 0) {
                throw new Error("Project not found or access denied.");
            }

            try {
                await this.ecs.send(new DeleteServiceCommand({
                    cluster: process.env.ECS_CLUSTER,
                    service: projectName,
                    force: true
                }));
            } catch (error) {}
    
            try {
                await ecrClient.send(new DeleteRepositoryCommand({
                    repositoryName: projectName,
                    force: true
                }));
            } catch (error) {}
    
            const domainsToClean = [
                `${projectName}.stackforgeengine.com`,
                `*.${projectName}.stackforgeengine.com`
            ];
            const domainResult = await pool.query(
                "SELECT domain_name, certificate_arn FROM domains WHERE project_id = $1 AND orgid = $2",
                [projectID, organizationID]
            );
            domainsToClean.push(
                ...domainResult.rows.map(row =>
                    row.domain_name.includes(".")
                        ? row.domain_name
                        : `${row.domain_name}.stackforgeengine.com`
                )
            );
            const uniqueDomains = Array.from(new Set(domainsToClean));
            const listenerArns = [process.env.ALB_LISTENER_ARN_HTTP, process.env.ALB_LISTENER_ARN_HTTPS];
            for (const listenerArn of listenerArns) {
                try {
                    const rulesResp = await elbv2Client.send(new DescribeRulesCommand({
                        ListenerArn: listenerArn
                    }));
                    for (const domain of uniqueDomains) {
                        const rules = rulesResp.Rules.filter(r =>
                            r.Conditions.some(c =>
                                c.Field === "host-header" && c.Values.includes(domain)
                            )
                        );
                        for (const rule of rules) {
                            await elbv2Client.send(new DeleteRuleCommand({
                                RuleArn: rule.RuleArn
                            }));
                        }
                    }
                } catch (error) {}
            }
    
            const certificateArns = domainResult.rows
                .map(row => row.certificate_arn)
                .filter(arn => arn);
            for (const certArn of certificateArns) {
                try {
                    const listenerResp = await elbv2Client.send(new DescribeListenersCommand({
                        ListenerArns: [process.env.ALB_LISTENER_ARN_HTTPS]
                    }));
                    const listenerCertificates = listenerResp.Listeners[0]?.Certificates?.map(c => c.CertificateArn) || [];
                    if (listenerCertificates.includes(certArn)) {
                        await elbv2Client.send(new DeleteListenerCertificatesCommand({
                            ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                            Certificates: [{ CertificateArn: certArn }]
                        }));
                    }
                    await acmClient.send(new DeleteCertificateCommand({
                        CertificateArn: certArn
                    }));
                } catch (error) {}
            }
    
            try {
                const changes = [];
                for (const domain of uniqueDomains) {
                    const recordName = domain.endsWith(".") ? domain : `${domain}.`;
                    try {
                        const listResp = await route53Client.send(new ListResourceRecordSetsCommand({
                            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                            StartRecordName: recordName,
                            MaxItems: "10"
                        }));
                        const records = listResp.ResourceRecordSets.filter(r =>
                            r.Name === recordName &&
                            ["A","CNAME","MX","AAAA"].includes(r.Type) &&
                            (
                                r.AliasTarget
                                    ? (
                                        r.AliasTarget.DNSName === process.env.LOAD_BALANCER_DNS ||
                                        r.AliasTarget.DNSName === `${process.env.LOAD_BALANCER_DNS}.`
                                      )
                                    : true
                            )
                        );
                        for (const record of records) {
                            changes.push({
                                Action: "DELETE",
                                ResourceRecordSet: record
                            });
                        }
                    } catch (error) {}
                }
    
                const seen = new Set();
                const deduped = [];
                for (const change of changes) {
                    const { Name, Type } = change.ResourceRecordSet;
                    const key = `${Name}||${Type}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        deduped.push(change);
                    }
                }
    
                if (deduped.length > 0) {
                    for (const change of deduped) {
                        try {
                            await route53Client.send(new ChangeResourceRecordSetsCommand({
                                HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                                ChangeBatch: { Changes: [change] }
                            }));
                        } catch (error) {}
                    }
                } else {}
            } catch (error) {}
    
            try {
                await codeBuildClient.send(new DeleteProjectCommand({ name: projectName }));
            } catch (error) {}
    
            const logGroups = [
                `/ecs/${projectName}`,
                `/aws/codebuild/${projectName}`
            ];
            for (const logGroup of logGroups) {
                try {
                    await cloudWatchLogsClient.send(new DeleteLogGroupCommand({ logGroupName: logGroup }));
                } catch (error) {}
            }
    
            try {
                const targetGroupResp = await elbv2Client.send(new DescribeTargetGroupsCommand({
                    Names: [projectName]
                }));
                if (targetGroupResp.TargetGroups?.length > 0) {
                    const targetGroupArn = targetGroupResp.TargetGroups[0].TargetGroupArn;
                    try {
                        await elbv2Client.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));
                    } catch (error) {}
                }
            } catch (error) {}
    
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
                throw new Error(`Failed to delete database records: ${error.message}`);
            }
    
            await pool.query(
                `INSERT INTO deployment_logs 
                 (orgid, username, project_id, project_name, action, timestamp, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [organizationID, userID, projectID, projectName, "delete", timestamp, "127.0.0.1"]
            );
    
            return { message: `Project ${projectName} and all associated resources deleted successfully.` };
        } catch (error) {
            throw new Error(`Failed to delete project: ${error.message}`);
        }
    }    
}

module.exports = new DeployManager();
