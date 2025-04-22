
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
    UpdateServiceCommand
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
    DescribeTargetHealthCommand
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
                throw new Error("GitHub token missing 'repo' scope required for private repository access");
            }
            return true;
        } catch (err) {
            throw new Error(`Invalid GitHub token or repository access: ${err.message}`);
        }
    }

    async ensureEcrRepo(repoName) {
        try {
            await this.ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
        } catch {
            await this.ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
        }
    }

    async createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, outputDirectory, githubAccessToken }) {
        if (!repository || typeof repository !== "string" || repository.trim() === "") {
            throw new Error("Invalid repository: repository parameter is required and must be a non-empty string");
        }
        if (!githubAccessToken || typeof githubAccessToken !== "string" || githubAccessToken.trim() === "") {
            throw new Error("Invalid GitHub access token: token is required and must be a non-empty string");
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
        } catch (err) {
            if (err.name === "ResourceAlreadyExistsException") {
                await codeBuildClient.send(new UpdateProjectCommand(projectParams));
            } else {
                throw new Error(`Failed to create CodeBuild project: ${err.message}`);
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
            throw new Error("GitHub access token is required for CodeBuild");
        }
        await this.validateGitHubToken(githubAccessToken, repository);
        try {
            await cloudWatchLogsClient.send(new CreateLogStreamCommand({
                logGroupName,
                logStreamName
            }));
        } catch (err) { }
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
            throw new Error(`Build failed: ${finalLogs}`);
        }
        const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:latest`;
        return { imageUri, logFile };
    }

    async streamCodeBuild({ projectName, repository, branch, githubAccessToken }, onChunk) {
        if (typeof onChunk !== "function") {
            throw new Error(`streamCodeBuild: onChunk is not a function, received: ${typeof onChunk}`);
        }
        if (!githubAccessToken) {
            onChunk("GitHub access token is required for CodeBuild\n");
            throw new Error("GitHub access token is required for CodeBuild");
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
        } catch (err) {
            onChunk(`Error creating log stream: ${err.message}\n`);
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
        } catch (err) {
            onChunk(`Failed to start CodeBuild: ${err.message}\n`);
            throw new Error(`CodeBuild start failed: ${err.message}`);
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
                throw new Error("Build process timed out");
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
            } catch (err) {
                if (err.name === "ResourceNotFoundException") {
                    retryCount++;
                    onChunk(`Log stream not yet available, retrying (${retryCount}/${maxRetries}), error: ${err.message}\n`);
                    if (retryCount >= maxRetries) {
                        onChunk(`Max retries reached for log stream\n`);
                        throw new Error(`Log stream not found after ${maxRetries} retries`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                onChunk(`Error fetching logs: ${err.message}\n`);
                throw err;
            }
            try {
                const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildId] }));
                buildStatus = buildInfo.builds[0].buildStatus;
                const buildPhase = buildInfo.builds[0].currentPhase || "UNKNOWN";
                onChunk(`Build status: ${buildStatus}, phase: ${buildPhase}\n`);
                if (buildStatus !== "IN_PROGRESS" && buildStatus !== "SUCCEEDED") {
                    const failureReason = buildInfo.builds[0].buildStatusDetails || `Unknown failure: ${lastLogEvent}`;
                    onChunk(`Build failed with status: ${buildStatus}, reason: ${failureReason}\n`);
                    throw new Error(`Build failed with status: ${buildStatus}, reason: ${lastLogEvent}`);
                }
            } catch (err) {
                onChunk(`Error checking build status: ${err.message}\n`);
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        if (buildStatus !== "SUCCEEDED") {
            onChunk(`Build did not succeed, final status: ${buildStatus}\n`);
            throw new Error(`Build failed with status: ${buildStatus}, reason: ${lastLogEvent}`);
        }
        const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:latest`;
        onChunk(`Build succeeded, image URI: ${imageUri}\n`);
        return imageUri;
    }

    async registerTaskDef({ projectName, imageUri, envVars }) {
        const logGroupName = `/ecs/${projectName}`;
        try {
            await cloudWatchLogsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } catch (err) {
            if (err.name !== "ResourceAlreadyExistsException") {
                throw new Error(`Failed to create CloudWatch log group: ${err.message}`);
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
        } catch (err) {
            if (err.name === "AccessDeniedException") {
                throw new Error(`IAM permissions error: ${err.message}. Ensure your IAM user or role has 'iam:PassRole' permission on the role ${process.env.ECS_EXECUTION_ROLE}.`);
            }
            throw err;
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
            } catch (err) {
                if (err.name !== "TargetGroupNotFoundException") {
                    throw err;
                }
            }
    
            let vpcId;
            try {
                const albResp = await this.elbv2.send(new DescribeLoadBalancersCommand({
                    LoadBalancerArns: [process.env.LOAD_BALANCER_ARN]
                }));
                if (albResp.LoadBalancers?.length === 0) {
                    throw new Error(`Load balancer not found: ${process.env.LOAD_BALANCER_ARN}`);
                }
                vpcId = albResp.LoadBalancers[0].VpcId;
            } catch (err) {
                throw new Error(`Failed to fetch ALB VPC ID: ${err.message}`);
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
        } catch (err) {
            throw new Error(`Failed to ensure target group: ${err.message}`);
        }
    }

    async createOrUpdateService({ projectName, taskDefArn, domainName, targetGroupArn }) {
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
            const tgDetails = await this.elbv2.send(new DescribeTargetGroupsCommand({
                TargetGroupArns: [targetGroupArn]
            }));
            const associatedLoadBalancers = tgDetails.TargetGroups[0].LoadBalancerArns || [];
            let httpsRuleArn;
            try {
                const httpsRulesResp = await this.elbv2.send(new DescribeRulesCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS
                }));
                const existingHttpsRule = httpsRulesResp.Rules.find(rule =>
                    rule.Conditions.some(cond =>
                        cond.Field === "host-header" && cond.Values.includes(`${domainName}.stackforgeengine.com`)
                    )
                );
    
                if (existingHttpsRule) {
                    const modifyResp = await this.elbv2.send(new ModifyRuleCommand({
                        RuleArn: existingHttpsRule.RuleArn,
                        Conditions: [{
                            Field: "host-header",
                            Values: [`${domainName}.stackforgeengine.com`]
                        }],
                        Actions: [{
                            Type: "forward",
                            TargetGroupArn: targetGroupArn
                        }]
                    }));
                    httpsRuleArn = existingHttpsRule.RuleArn;
                } else {
                    const httpsPriorities = httpsRulesResp.Rules.map(rule => parseInt(rule.Priority)).filter(p => !isNaN(p));
                    const httpsPriority = httpsPriorities.length > 0 ? Math.max(...httpsPriorities) + 1 : 1;
    
                    const httpsRuleResp = await this.elbv2.send(new CreateRuleCommand({
                        ListenerArn: process.env.ALB_LISTENER_ARN_HTTPS,
                        Conditions: [{
                            Field: "host-header",
                            Values: [`${domainName}.stackforgeengine.com`]
                        }],
                        Priority: httpsPriority,
                        Actions: [{
                            Type: "forward",
                            TargetGroupArn: targetGroupArn
                        }]
                    }));
                    httpsRuleArn = httpsRuleResp.Rules[0].RuleArn;
                }
            } catch (err) {
                throw err;
            }
    
            try {
                const httpRulesResp = await this.elbv2.send(new DescribeRulesCommand({
                    ListenerArn: process.env.ALB_LISTENER_ARN_HTTP
                }));
                const existingHttpRule = httpRulesResp.Rules.find(rule =>
                    rule.Conditions.some(cond =>
                        cond.Field === "host-header" && cond.Values.includes(`${domainName}.stackforgeengine.com`)
                    )
                );
    
                if (existingHttpRule) {
                    await this.elbv2.send(new ModifyRuleCommand({
                        RuleArn: existingHttpRule.RuleArn,
                        Conditions: [{
                            Field: "host-header",
                            Values: [`${domainName}.stackforgeengine.com`]
                        }],
                        Actions: [{
                            Type: "redirect",
                            RedirectConfig: {
                                Protocol: "HTTPS",
                                Port: "443",
                                StatusCode: "HTTP_301",
                                Host: "#{host}",
                                Path: "/#{path}",
                                Query: "#{query}"
                            }
                        }]
                    }));
                } else {
                    const httpPriorities = httpRulesResp.Rules.map(rule => parseInt(rule.Priority)).filter(p => !isNaN(p));
                    const httpPriority = httpPriorities.length > 0 ? Math.max(...httpPriorities) + 1 : 1;
    
                    const httpRuleResp = await this.elbv2.send(new CreateRuleCommand({
                        ListenerArn: process.env.ALB_LISTENER_ARN_HTTP,
                        Conditions: [{
                            Field: "host-header",
                            Values: [`${domainName}.stackforgeengine.com`]
                        }],
                        Priority: httpPriority,
                        Actions: [{
                            Type: "redirect",
                            RedirectConfig: {
                                Protocol: "HTTPS",
                                Port: "443",
                                StatusCode: "HTTP_301",
                                Host: "#{host}",
                                Path: "/#{path}",
                                Query: "#{query}"
                            }
                        }]
                    }));
                }
            } catch (err) {}
    
            const tgDetailsAfter = await this.elbv2.send(new DescribeTargetGroupsCommand({
                TargetGroupArns: [targetGroupArn]
            }));
            const associatedLoadBalancersAfter = tgDetailsAfter.TargetGroups[0].LoadBalancerArns || [];
            if (associatedLoadBalancersAfter.length === 0) {
                throw new Error(`Target group ${targetGroupArn} is still not associated with any load balancer after creating listener rules`);
            }
    
            const describeResp = await this.ecs.send(new DescribeServicesCommand({
                cluster: process.env.ECS_CLUSTER,
                services: [projectName]
            }));
            const serviceExists = describeResp.services?.length > 0 && describeResp.services[0].status !== "INACTIVE";
    
            if (serviceExists) {
                await this.ecs.send(new UpdateServiceCommand({
                    ...serviceParams,
                    service: projectName,
                    forceNewDeployment: true
                }));
            } else {
                await this.ecs.send(new CreateServiceCommand({
                    ...serviceParams,
                    serviceName: projectName
                }));
            }
        } catch (err) {
            throw new Error(`Failed to create/update ECS service: ${err.message}`);
        }
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
        } catch (err) {
            fileLogs = `Error reading log files: ${err.message}\n`;
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
                throw new Error("Deployment not found");
            }
            deploymentUrl = deploymentResult.rows[0].url;
        } catch (err) {
            deploymentUrl = `https://${projectName}.stackforgeengine.com`;
        }

        let hostname;
        try {
            const urlObj = new URL(deploymentUrl);
            hostname = urlObj.hostname;
        } catch (err) {
            hostname = `${projectName}.stackforgeengine.com`;
        }

        let httpStatus = null;
        try {
            const response = await axios.get(deploymentUrl, { timeout: 5000 });
            httpStatus = response.status;
        } catch (err) {
            httpStatus = err.response?.status || 503;
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
        await this.ensureEcrRepo(projectName);
        const tokenResult = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].github_access_token) {
            throw new Error("GitHub account not connected");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, githubAccessToken });
        const { imageUri, logFile } = await this.startCodeBuild({ projectName, repository, branch, logDir, githubAccessToken });
        const taskDefArn = await this.registerTaskDef({ projectName, imageUri, envVars });
        const targetGroupArn = await this.ensureTargetGroup(projectName);
        await this.createOrUpdateService({ projectName, taskDefArn, domainName, targetGroupArn });
        return taskDefArn;
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
            throw new Error("GitHub account not connected");
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
            throw new Error("GitHub account not connected");
        }
        const githubAccessToken = tokenResult.rows[0].github_access_token;
        try {
            await this.createCodeBuildProject({ projectName, repository, branch, rootDirectory, installCommand, buildCommand, githubAccessToken });
            onData(`CodeBuild project configured for ${projectName}\n`);
            const imageUri = await this.streamCodeBuild({ projectName, repository, branch, githubAccessToken }, onData);
            onData(`Build completed successfully. Image pushed to ${imageUri}\n`);
            return logDir;
        } catch (err) {
            onData(`Error during build process: ${err.message}\n`);
            throw err;
        }
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
                     SET updated_at = $1
                     WHERE domain_id = $2`,
                    [timestamp, domainId]
                );
            } else {
                domainId = uuidv4();
                await pool.query(
                    `INSERT INTO domains 
                     (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
                );
            }
            await pool.query(
                "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                ["inactive", timestamp, projectID, "active"]
            );
            await pool.query(
                `INSERT INTO deployments 
                 (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [organizationID, userID, deploymentId, projectID, domainId, "building", url, template || "default", timestamp, timestamp, timestamp, null]
            );
            await pool.query(
                `INSERT INTO deployment_logs 
                 (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [organizationID, userID, projectID, projectName, "update", deploymentId, timestamp, "127.0.0.1"]
            );
        }
        try {
            await this.updateDNSRecord(domainName);
        } catch (error) {
            fs.appendFileSync(path.join(logDir, "error.log"), `DNS update failed: ${error.message}\n`);
            throw error;
        }
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
                envVars
            });
            if (isNewProject) {
                await pool.query(
                    `INSERT INTO projects 
                     (orgid, username, project_id, name, description, branch, team_name, root_directory, output_directory, build_command, install_command, env_vars, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image) 
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,$17,$18)`,
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
                        deploymentId,
                        null
                    ]
                );
                await pool.query(
                    `INSERT INTO domains 
                     (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
                );
                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [organizationID, userID, deploymentId, projectID, domainId, "active", url, template || "default", timestamp, timestamp, timestamp, taskDefArn]
                );
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, projectID, projectName, "launch", deploymentId, timestamp, "127.0.0.1"]
                );
            } else {
                const now = new Date().toISOString();
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2, last_deployed_at = $2, task_def_arn = $3 WHERE deployment_id = $4",
                    ["active", now, taskDefArn, deploymentId]
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
                    [organizationID, userID, projectID, projectName, "build_failed", deploymentId, now, "127.0.0.1"]
                );
                await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir);
                await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            }
            throw error;
        }
    }

    async launchWebsiteStream(
        { userID, organizationID, projectName, domainName, template, repository, branch, teamName, rootDirectory, outputDirectory, buildCommand, installCommand, envVars },
        onData
    ) {
        if (typeof onData !== "function") {
            throw new Error(`launchWebsiteStream: onData is not a function, received: ${typeof onData}`);
        }
        onData(`Starting deployment for project: ${projectName}\n`);
        const deploymentId = uuidv4();
        const timestamp = new Date().toISOString();
        const url = `https://${domainName}.stackforgeengine.com`;
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        try {
            fs.mkdirSync(logDir, { recursive: true });
            onData(`Created log directory: ${logDir}\n`);
        } catch (err) {
            onData(`Failed to set up log directory: ${err.message}\n`);
            throw new Error(`Log directory setup failed: ${err.message}`);
        }
        let projectID;
        let isNewProject = false;
        let domainId;
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
        } catch (err) {
            onData(`Error checking project: ${err.message}\n`);
            throw new Error(`Project check failed: ${err.message}`);
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
                         SET updated_at = $1
                         WHERE domain_id = $2`,
                        [timestamp, domainId]
                    );
                    onData(`Updated domain timestamp\n`);
                } else {
                    domainId = uuidv4();
                    await pool.query(
                        `INSERT INTO domains 
                         (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
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
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [organizationID, userID, deploymentId, projectID, domainId, "building", url, template || "default", timestamp, timestamp, timestamp, null]
                );
                onData(`Inserted new deployment record, ID: ${deploymentId}\n`);
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, projectID, projectName, "update", deploymentId, timestamp, "127.0.0.1"]
                );
                onData(`Logged deployment action: update\n`);
            } catch (err) {
                onData(`Error managing domain/deployment records: ${err.message}\n`);
                throw new Error(`Domain/deployment record management failed: ${err.message}`);
            }
        }
        let streamBuffer = "";
        try {
            onData(`Updating DNS record for ${domainName}\n`);
            await this.updateDNSRecord(domainName);
            onData("DNS record updated successfully\n");
            onData(`Ensuring ECR repository for ${projectName}\n`);
            await this.ensureEcrRepo(projectName);
            onData(`ECR repository ensured for ${projectName}\n`);
            onData(`Fetching GitHub access token for user: ${userID}\n`);
            const tokenResult2 = await pool.query("SELECT github_access_token FROM users WHERE username = $1", [userID]);
            if (tokenResult2.rows.length === 0 || !tokenResult2.rows[0].github_access_token) {
                onData(`No GitHub access token found for user: ${userID}\n`);
                throw new Error("GitHub account not connected");
            }
            const githubAccessToken2 = tokenResult2.rows[0].github_access_token;
            onData(`GitHub access token retrieved successfully\n`);
            onData(`Creating/updating CodeBuild project for ${projectName}\n`);
            await this.createCodeBuildProject({
                projectName,
                repository,
                branch,
                rootDirectory,
                installCommand,
                buildCommand,
                outputDirectory,
                githubAccessToken: githubAccessToken2
            });
            onData(`CodeBuild project created/updated for ${projectName}\n`);
            onData(`Starting CodeBuild process\n`);
            const capturingOnData = chunk => {
                streamBuffer += chunk;
                onData(chunk);
            };
            onData(`Preparing to start CodeBuild streaming\n`);
            const imageUri = await this.streamCodeBuild({ projectName, repository, branch, githubAccessToken: githubAccessToken2 }, capturingOnData);
            onData(`Docker image pushed to ${imageUri}\n`);
            onData(`Registering ECS task definition\n`);
            const taskDefArn2 = await this.registerTaskDef({ projectName, imageUri, envVars });
            onData(`ECS task definition registered: ${taskDefArn2}\n`);
            onData(`Ensuring target group\n`);
            const targetGroupArn2 = await this.ensureTargetGroup(projectName);
            onData(`Target group ensured: ${targetGroupArn2}\n`);
            onData(`Creating/updating ECS service\n`);
            await this.createOrUpdateService({ projectName, taskDefArn: taskDefArn2, domainName, targetGroupArn: targetGroupArn2 });
            onData(`ECS service created/updated for ${projectName}\n`);
    
            onData(`Checking ECS service status\n`);
            try {
                const serviceDesc = await this.ecs.send(new DescribeServicesCommand({
                    cluster: process.env.ECS_CLUSTER,
                    services: [projectName]
                }));
                const service = serviceDesc.services?.[0];
                if (service) {
                    onData(`Service Status: ${service.status}, Desired Count: ${service.desiredCount}, Running Count: ${service.runningCount}\n`);
                    if (service.runningCount === 0) {
                        onData(`Warning: No tasks are running for service ${projectName}\n`);
                    }
                    if (service.events?.length > 0) {
                        onData(`Recent Service Events:\n`);
                        service.events.slice(0, 5).forEach(event => {
                            onData(`${event.createdAt}: ${event.message}\n`);
                        });
                    }
                } else {
                    onData(`Error: Service ${projectName} not found\n`);
                }
            } catch (err) {
                onData(`Error checking ECS service status: ${err.message}\n`);
            }
    
            onData(`Checking load balancer listener rules\n`);
            try {
                const listeners = await this.elbv2.send(new DescribeListenersCommand({
                    LoadBalancerArn: process.env.LOAD_BALANCER_ARN
                }));
                const listenerArns = [
                    { arn: process.env.ALB_LISTENER_ARN_HTTP, protocol: "HTTP", port: "80" },
                    { arn: process.env.ALB_LISTENER_ARN_HTTPS, protocol: "HTTPS", port: "443" }
                ];
    
                for (const listener of listenerArns) {
                    const rules = await this.elbv2.send(new DescribeRulesCommand({
                        ListenerArn: listener.arn
                    }));
                    const relevantRules = rules.Rules?.filter(rule => 
                        rule.Conditions.some(cond => 
                            cond.Field === "host-header" && 
                            cond.Values.includes(`${projectName}.stackforgeengine.com`)
                        )
                    );
                    if (relevantRules?.length > 0) {
                        onData(`Listener ${listener.protocol}:${listener.port} rules for ${projectName}.stackforgeengine.com:\n`);
                        relevantRules.forEach(rule => {
                            onData(`Rule Priority: ${rule.Priority}, Actions: ${JSON.stringify(rule.Actions)}\n`);
                        });
                    } else {
                        onData(`No listener rules found for ${projectName}.stackforgeengine.com on ${listener.protocol}:${listener.port}\n`);
                    }
                }
            } catch (err) {
                onData(`Error checking listener rules: ${err.message}\n`);
            }
    
            onData(`Checking target group health and task network interfaces\n`);
            try {
                const targetGroupResp = await this.elbv2.send(new DescribeTargetGroupsCommand({ Names: [projectName] }));
                const targetGroupArn = targetGroupResp.TargetGroups?.[0]?.TargetGroupArn;
                if (targetGroupArn) {
                    const healthResp = await this.elbv2.send(new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }));
                    if (healthResp.TargetHealthDescriptions?.length > 0) {
                        healthResp.TargetHealthDescriptions.forEach(th => {
                            onData(`Target: ${th.Target.Id}:${th.Target.Port}, Health: ${th.TargetHealth.State}, Reason: ${th.TargetHealth.Reason || 'N/A'}, Description: ${th.TargetHealth.Description || 'N/A'}\n`);
                        });
                    } else {
                        onData(`No registered targets found for target group ${projectName}\n`);
                    }
                } else {
                    onData(`Target group for ${projectName} not found\n`);
                }
    
                const serviceDesc = await this.ecs.send(new DescribeServicesCommand({
                    cluster: process.env.ECS_CLUSTER,
                    services: [projectName]
                }));
                const service = serviceDesc.services?.[0];
                if (service?.tasks?.length > 0) {
                    const taskResp = await this.ecs.send(new DescribeTasksCommand({
                        cluster: process.env.ECS_CLUSTER,
                        tasks: [service.tasks[0].taskArn]
                    }));
                    const task = taskResp.tasks?.[0];
                    if (task) {
                        const networkInterface = task.attachments?.find(a => a.type === "ElasticNetworkInterface")?.details?.find(d => d.name === "privateIPv4Address");
                        onData(`Task Network Interface: Private IP ${networkInterface?.value || 'N/A'}\n`);
                    }
                }
            } catch (err) {
                onData(`Error checking target group health or task network interfaces: ${err.message}\n`);
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
                        null
                    ]
                );
                onData(`Project record created\n`);
                await pool.query(
                    `INSERT INTO domains 
                     (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, domainId, domainName, projectID, userID, timestamp, timestamp]
                );
                onData(`Domain record created\n`);
                await pool.query(
                    `INSERT INTO deployments 
                     (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [organizationID, userID, deploymentId, projectID, domainId, "active", url, template || "default", timestamp, timestamp, timestamp, taskDefArn2]
                );
                onData(`Deployment record created\n`);
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, projectID, projectName, "launch", deploymentId, timestamp, "127.0.0.1"]
                );
                onData(`Deployment log created\n`);
            } else {
                const now2 = new Date().toISOString();
                onData(`Updating deployment status to active\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2, last_deployed_at = $2, task_def_arn = $3 WHERE deployment_id = $4",
                    ["active", now2, taskDefArn2, deploymentId]
                );
                onData(`Deployment status updated\n`);
            }
            onData(`Recording build logs\n`);
            await this.recordBuildLogCombined(organizationID, userID, deploymentId, logDir, streamBuffer);
            onData(`Build logs recorded\n`);
            onData(`Recording runtime logs\n`);
            await this.recordRuntimeLogs(organizationID, userID, deploymentId, projectName);
            onData(`Runtime logs recorded\n`);
            return { url, deploymentId, logPath: logDir, taskDefArn: taskDefArn2 };
        } catch (error) {
            onData(`Deployment failed: ${error.message}\n`);
            if (!isNewProject) {
                const now3 = new Date().toISOString();
                onData(`Marking deployment as failed\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE deployment_id = $3",
                    ["failed", now3, deploymentId]
                );
                onData(`Logging deployment failure\n`);
                await pool.query(
                    `INSERT INTO deployment_logs 
                     (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [organizationID, userID, projectID, projectName, "build_failed", deploymentId, now3, "127.0.0.1"]
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

    async updateDNSRecord(subdomain) {
        if (!subdomain || subdomain.trim() === "") {
            throw new Error("Subdomain cannot be empty");
        }
        const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
        const albZoneId = process.env.LOAD_BALANCER_ZONE_ID;
        const loadBalancerDNS = process.env.LOAD_BALANCER_DNS;
        if (!hostedZoneId || !albZoneId || !loadBalancerDNS) {
            throw new Error("Route53 DNS configuration missing");
        }
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
        } catch (err) {
            throw new Error(`Failed to list existing DNS records: ${err.message}`);
        }
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
        try {
            await route53Client.send(new ChangeResourceRecordSetsCommand(params));
        } catch (err) {
            throw new Error(`Failed to update DNS record: ${err.message}`);
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
            throw new Error("Deployment not found or access denied");
        }
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

    async rollbackDeployment({ organizationID, userID, projectID, deploymentID }) {
        const timestamp = new Date().toISOString();
        const deploymentResult = await pool.query(
            `SELECT d.*, p.name as project_name 
           FROM deployments d 
           JOIN projects p ON d.project_id = p.project_id 
           WHERE d.deployment_id = $1 AND d.orgid = $2 AND d.username = $3`,
            [deploymentID, organizationID, userID]
        );
        if (deploymentResult.rows.length === 0) {
            throw new Error("Deployment not found or access denied");
        }
        const deployment = deploymentResult.rows[0];
        const projectName = deployment.project_name;
        const domainName = deployment.url.replace('https://', '').split('.')[0];
        const currentDeploymentResult = await pool.query(
            `SELECT deployment_id 
           FROM deployments 
           WHERE project_id = $1 AND status = 'active'`,
            [projectID]
        );
        const taskDefArn = await this.getTaskDefinitionArn(projectName, deploymentID);
        const cluster = process.env.ECS_CLUSTER;
        const serviceName = projectName;
        try {
            const targetGroupArn = await this.ensureTargetGroup(projectName);
            await this.ecs.send(new UpdateServiceCommand({
                cluster,
                service: serviceName,
                taskDefinition: taskDefArn,
                forceNewDeployment: true
            }));
            if (currentDeploymentResult.rows.length > 0) {
                await pool.query(
                    `UPDATE deployments 
               SET status = 'inactive', updated_at = $1 
               WHERE deployment_id = $2`,
                    [timestamp, currentDeploymentResult.rows[0].deployment_id]
                );
            }
            await pool.query(
                `UPDATE deployments 
             SET status = 'active', updated_at = $1, last_deployed_at = $1 
             WHERE deployment_id = $2`,
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
                `INSERT INTO deployment_logs 
               (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [organizationID, userID, projectID, projectName, "rollback", deploymentID, timestamp, "127.0.0.1"]
            );
            await this.recordRuntimeLogs(organizationID, userID, deploymentID, projectName);
            return {
                message: `Successfully rolled back to deployment ${deploymentID}.`,
                url: deployment.url,
                deploymentId: deploymentID
            };
        } catch (error) {
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }

    async getTaskDefinitionArn(projectName, deploymentID) {
        try {
            const deploymentResult = await pool.query(
                `SELECT task_def_arn 
                 FROM deployments 
                 WHERE deployment_id = $1`,
                [deploymentID]
            );
            if (deploymentResult.rows.length === 0) {
                throw new Error(`Deployment ${deploymentID} not found`);
            }
            const taskDefArn = deploymentResult.rows[0].task_def_arn;
            if (!taskDefArn) {
                return `arn:aws:ecs:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:task-definition/${projectName}:1`;
            }
            return taskDefArn;
        } catch (error) {
            throw new Error(`Failed to retrieve task definition ARN: ${error.message}`);
        }
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
                throw new Error("projectName is required and cannot be empty");
            }
            if (!repository || !branch) {
                sendLine("Error: repository and branch are required\n");
                throw new Error("repository and branch are required");
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
            clearInterval(heartbeat);
            res.write(`data: __BUILD_COMPLETE__\n\n`);
            res.end();
        } catch (err) {
            clearInterval(heartbeat);
            sendLine(`__BUILD_ERROR__${err.message}\n`);
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
    if (!repository || !branch || !projectName)
        return res.status(400).json({ message: "Missing required deployment information." });
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
            return res
                .status(200)
                .json({
                    message: "Project deployed successfully.",
                    url: deploymentResult.url,
                    deploymentId: deploymentResult.deploymentId,
                    buildLog: deploymentResult.logPath
                });
        } catch (err) {
            return res.status(500).json({ message: err.message, buildLog: err.logPath });
        }
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
                        headers: httpErr.response?.headers || {},
                        performance: null,
                        error: `HTTP request failed: ${httpErr.message}`
                    };
                }

                if (websiteResponse) {
                    const responseTime = Date.now() - startTime;
                    let contentLength = websiteResponse.headers["content-length"] || (websiteResponse.data ? websiteResponse.data.toString().length : 0);

                    let performanceMetrics = null;
                    try {
                        const browser = await puppeteer.launch({ headless: true });
                        const page = await browser.newPage();
                        await page.goto(websiteURL, { waitUntil: "networkidle2", timeout: 30000 });

                        performanceMetrics = await page.evaluate(() => {
                            const { loadEventEnd, navigationStart } = performance.timing;
                            const pageLoadTime = loadEventEnd - navigationStart;
                            const scripts = document.querySelectorAll("script").length;
                            const images = document.querySelectorAll("img").length;
                            const links = document.querySelectorAll("a").length;
                            return { pageLoadTime, scripts, images, links };
                        });

                        await browser.close();
                    } catch (puppeteerErr) { }

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
                websiteAnalytics = { error: `Website analytics failed: ${err.message}` };
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

module.exports = router;