
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { pool } = require("../../config/db");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const jwt = require('jsonwebtoken');
const https = require('https');
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
    ListServicesCommand,
    DescribeTasksCommand,
    StopTaskCommand,
    RegisterTaskDefinitionCommand,
    DescribeTaskDefinitionCommand,
    DescribeServicesCommand,
    DeregisterTaskDefinitionCommand,
    ListTaskDefinitionsCommand,
    ListTasksCommand,
    CreateServiceCommand,
    DeleteServiceCommand,
    UpdateServiceCommand,
    waitUntilServicesStable
} = require("@aws-sdk/client-ecs");
const {
    ElasticLoadBalancingV2Client,
    DescribeListenerCertificatesCommand,
    DescribeTargetGroupsCommand,
    DescribeTargetGroupAttributesCommand,
    DescribeLoadBalancersCommand,
    DescribeListenersCommand,
    DescribeTargetHealthCommand,
    DescribeRulesCommand,
    CreateRuleCommand,
    ModifyRuleCommand,
    ModifyTargetGroupAttributesCommand,
    CreateTargetGroupCommand,
    DeleteRuleCommand,
    DeleteTargetGroupCommand,
    DeregisterTargetsCommand,
    CreateLoadBalancerCommand,
    CreateListenerCommand
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
    DeleteLogGroupCommand,
    DescribeLogGroupsCommand,
} = require("@aws-sdk/client-cloudwatch-logs");
const {
    ACMClient,
    ListCertificatesCommand,
    RequestCertificateCommand,
    DescribeCertificateCommand,
    DeleteCertificateCommand,
    RemoveListenerCertificatesCommand
} = require("@aws-sdk/client-acm");
const {
    CloudFrontClient,
    CreateInvalidationCommand,
    ListDistributionsCommand,
    GetInvalidationCommand
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
        const describeResp = await this.ecr.send(new DescribeRepositoriesCommand({}));
        const existingRepos = describeResp.repositories || [];

        let activeProjects = new Set();
        try {
            const projRows = await pool.query("SELECT name FROM projects");
            projRows.rows.forEach(r => {
                if (r.name) activeProjects.add(r.name);
            });
        } catch (error) {
            activeProjects = new Set();
        }

        const MAX_SAFE_REPOS = 900;
        if (existingRepos.length >= MAX_SAFE_REPOS) {
            const inactiveRepos = [];
            for (const repo of existingRepos) {
                const name = repo.repositoryName;
                if (name === repoName) {
                    continue;
                }
                if (activeProjects.has(name)) {
                    continue;
                }
                let images = [];
                try {
                    const imagesResp = await this.ecr.send(new DescribeImagesCommand({
                        repositoryName: name,
                        filter: { tagStatus: "ANY" }
                    }));
                    images = imagesResp.imageDetails || [];
                } catch (error) {
                    continue;
                }
                if (images.length === 0) {
                    inactiveRepos.push(repo);
                }
            }

            inactiveRepos.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            const toDeleteCount = existingRepos.length - (MAX_SAFE_REPOS - 1);
            let deletedCount = 0;
            for (let i = 0; i < inactiveRepos.length && deletedCount < toDeleteCount; i++) {
                const repoToDelete = inactiveRepos[i].repositoryName;
                try {
                    await this.ecr.send(new DeleteRepositoryCommand({
                        repositoryName: repoToDelete,
                        force: true
                    }));
                    deletedCount += 1;
                } catch (error) { }
            }

            if (deletedCount < toDeleteCount) {
                throw new Error(
                    `Cannot prune enough ECR repos: Found only ${deletedCount} inactive repos, ` +
                    `but need to delete ${toDeleteCount}. Consider manual cleanup or requesting a quota increase.`
                );
            }
        }

        try {
            await this.ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repoName] }));
        } catch (error) {
            if (error.name === "RepositoryNotFoundException" || error.name === "RepositoryNotFound") {
                try {
                    await this.ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
                } catch (createErr) {
                    if (createErr.name === "TooManyRepositoriesException" || createErr.name === "TooManyRepositories") {
                        throw new Error(
                            "TooManyRepositories: unable to create new repo even after pruning inactive ones. " +
                            "Consider requesting an ECR quota increase."
                        );
                    } else {
                        throw createErr;
                    }
                }
            } else {
                throw error;
            }
        }
    }

    async ensureTargetGroup(projectName, subdomain) {
        if (!projectName || typeof projectName !== "string" || !projectName.trim()) {
            throw new Error(`Invalid projectName: ${projectName}.`);
        }

        const p0 = projectName.toLowerCase();

        let baseName;
        if (!subdomain || subdomain.toLowerCase() === p0) {
            baseName = p0.slice(0, 26);
        } else {
            const subSlug = subdomain
                .split(".")[0]
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "");
            const pPart = p0.slice(0, 18);
            baseName = `${pPart}-${subSlug.slice(0, 7)}`;
        }

        const matchOld = new RegExp(`^${baseName}(?:-v\\d+)?$`);
        let tgName = baseName;
        let tgArn = null;
        let version = 0;

        let vpcID = process.env.VPC_ID;
        if (!vpcID) {
            const ec2 = new EC2Client({ region: process.env.AWS_REGION });
            try {
                const vpcsResp = await ec2.send(
                    new DescribeVpcsCommand({ Filters: [{ Name: "is-default", Values: ["true"] }] })
                );
                if (vpcsResp.Vpcs && vpcsResp.Vpcs.length > 0 && vpcsResp.Vpcs[0].VpcId) {
                    vpcID = vpcsResp.Vpcs[0].VpcId;
                } else {
                    throw new Error("No default VPC found.");
                }
            } catch (error) { }
        }

        let listenerArn = await this.getOrCreateListenerARN();
        if (!listenerArn) {
            throw new Error("No ALB listener ARN available.");
        }

        const desired = {
            Protocol: "HTTP",
            Port: 80,
            VpcId: vpcID,
            TargetType: "ip",
            HealthCheckProtocol: "HTTP",
            HealthCheckPort: "traffic-port",
            HealthCheckPath: "/",
            HealthCheckIntervalSeconds: 30,
            HealthCheckTimeoutSeconds: 5,
            HealthyThresholdCount: 5,
            UnhealthyThresholdCount: 2,
        };

        const hostHeader =
            !subdomain || subdomain.toLowerCase() === p0
                ? `${p0}.stackforgeengine.com`
                : `${subdomain}.stackforgeengine.com`;

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

        const elbv2 = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });


        const allTgsResp = await elbv2.send(new DescribeTargetGroupsCommand({}));
        const allTgs = allTgsResp.TargetGroups || [];
        const oldTgs = allTgs.filter((tg) => matchOld.test(tg.TargetGroupName) && tg.TargetGroupName !== tgName);

        for (const oldTg of oldTgs) {
            try {
                const rulesResp = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                for (const r of rulesResp.Rules ?? []) {
                    if (
                        !r.IsDefault &&
                        r.Actions.some((a) => a.Type === "forward" && a.TargetGroupArn === oldTg.TargetGroupArn)
                    ) {
                        await elbv2.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
                    }
                }
                await elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: oldTg.TargetGroupArn }));
            } catch (error) {
                if (error.name !== "ResourceInUseException") throw error;
            }
        }

        const getExisting = async (name) => {
            try {
                const d = await elbv2.send(new DescribeTargetGroupsCommand({ Names: [name] }));
                return d.TargetGroups?.[0] || null;
            } catch (error) {
                if (error.name === "TargetGroupNotFoundException") return null;
                throw error;
            }
        };

        while (true) {
            const existing = await getExisting(tgName);

            if (existing && isCompatible(existing)) {
                tgArn = existing.TargetGroupArn;
                break;
            }

            if (existing) {
                try {
                    const rulesResp = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                    for (const r of rulesResp.Rules ?? []) {
                        if (
                            !r.IsDefault &&
                            r.Actions.some((a) => a.Type === "forward" && a.TargetGroupArn === existing.TargetGroupArn)
                        ) {
                            await elbv2.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
                        }
                    }
                    await elbv2.send(new DeleteTargetGroupCommand({ TargetGroupArn: existing.TargetGroupArn }));
                } catch (error) {
                    if (error.name === "ResourceInUseException") {
                        version += 1;
                        tgName = `${baseName}-v${version}`.slice(0, 32);
                        continue;
                    }
                    throw error;
                }
            }

            if (!tgArn) {
                try {
                    const c = await elbv2.send(new CreateTargetGroupCommand({ Name: tgName, ...desired }));
                    tgArn = c.TargetGroups[0].TargetGroupArn;
                    break;
                } catch (error) {
                    if (error.name === "TooManyTargetGroups") {
                        throw new Error("TooManyTargetGroups: consider requesting a Service Quotas increase.");
                    }
                    throw error;
                }
            }
        }

        listenerArn = await this.getOrCreateListenerARN();
        const { Rules } = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));

        const existsRule = Rules?.find(
            (r) =>
                !r.IsDefault &&
                r.Conditions.some((c) => c.Field === "host-header" && c.Values.includes(hostHeader)) &&
                r.Actions.some((a) => a.Type === "forward" && a.TargetGroupArn === tgArn)
        );

        if (!existsRule) {
            const used = new Set(Rules.filter((r) => !r.IsDefault).map((r) => Number(r.Priority)));
            let priority = 10000;
            while (used.has(priority)) priority += 1;

            if (priority > 50000) {
                listenerArn = await this.createNewALBListener();
                const fresh = await elbv2.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
                used.clear();
                fresh.Rules.filter((r) => !r.IsDefault).forEach((r) => used.add(Number(r.Priority)));

                priority = 1;
                while (used.has(priority)) priority += 1;
            }

            await elbv2.send(
                new CreateRuleCommand({
                    ListenerArn: listenerArn,
                    Priority: priority,
                    Conditions: [{ Field: "host-header", Values: [hostHeader] }],
                    Actions: [{ Type: "forward", TargetGroupArn: tgArn }],
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

    async getDeploymentStatus(deploymentID, organizationID, userID) {
        const deploymentResult = await pool.query(
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
            `,
            [deploymentID, organizationID, userID]
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
                `
                    SELECT task_def_arn 
                    FROM deployments 
                    WHERE deployment_id = $1
                `,
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
                    d.last_deployed_at
                FROM deployments d
                WHERE d.orgid = $1
                ORDER BY d.created_at DESC
            `,
            [organizationID]
        );
        return deploymentListResult.rows;
    }

    async listProjects(organizationID) {
        const projectListResult = await pool.query(
            `
                SELECT * FROM projects
                WHERE orgid = $1
                ORDER BY created_at DESC
            `,
            [organizationID]
        );
        return projectListResult.rows;
    }

    async listDomains(organizationID) {
        const domainListResult = await pool.query(
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
            `,
            [organizationID]
        );
        return domainListResult.rows;
    }

    async getOrCreateListenerARN() {
        if (this._currentListenerArn) {
            return this._currentListenerArn;
        }

        if (!process.env.ALB_LISTENER_ARN_HTTPS) {
            throw new Error("ALB_LISTENER_ARN_HTTPS is not set in env.");
        }
        this._currentListenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
        return this._currentListenerArn;
    }


    async createNewALBListener() {
        const elbClient = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const albName = `stackforge-alb-${Date.now()}`;
        const subnetIDs = process.env.SUBNET_IDS?.split(",").map(s => s.trim());
        const securityGroupIDs = process.env.SECURITY_GROUP_IDS?.split(",").map(s => s.trim());
        if (!subnetIDs?.length || !securityGroupIDs?.length) {
            throw new Error("SUBNET_IDS or SECURITY_GROUP_IDS missing in env for new ALB.");
        }

        const createAlbParams = {
            Name: albName,
            Subnets: subnetIDs,
            SecurityGroups: securityGroupIDs,
            Scheme: "internet-facing",
            Type: "application",
            IpAddressType: "ipv4"
        };

        let lbArn, lbDnsName;
        try {
            const { LoadBalancers } = await elbClient.send(new CreateLoadBalancerCommand(createAlbParams));
            lbArn = LoadBalancers[0].LoadBalancerArn;
            lbDnsName = LoadBalancers[0].DNSName;
        } catch (error) {
            throw new Error(`Failed to create new ALB (${albName}): ${error.message}`);
        }

        if (!process.env.CERTIFICATE_ARN) {
            throw new Error("CERTIFICATE_ARN is required to create an HTTPS listener.");
        }
        const listenerParams = {
            LoadBalancerArn: lbArn,
            Protocol: "HTTPS",
            Port: 443,
            Certificates: [
                { CertificateArn: process.env.CERTIFICATE_ARN }
            ],
            DefaultActions: [
                {
                    Type: "fixed-response",
                    FixedResponseConfig: {
                        StatusCode: "404",
                        ContentType: "text/plain",
                        MessageBody: "Not Found"
                    }
                }
            ]
        };

        let listenerArn;
        try {
            const { Listeners } = await elbClient.send(new CreateListenerCommand(listenerParams));
            listenerArn = Listeners[0].ListenerArn;
        } catch (error) {
            throw new Error(`Failed to create HTTPS listener on ALB (${albName}): ${error.message}`);
        }

        this._currentListenerArn = listenerArn;
        return listenerArn;
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

        ["ECS_CLUSTER_ARN", "SUBNET_IDS", "SECURITY_GROUP_IDS", "ALB_LISTENER_ARN_HTTPS", "AWS_REGION"].forEach(
            k => { if (!process.env[k]) throw new Error(`Missing env ${k}.`); }
        );

        if (subdomain && subdomain.toLowerCase() === projectName.toLowerCase()) {
            subdomain = null;
        }

        if (subdomain && !/^[a-zA-Z0-9.-]+$/.test(subdomain)) {
            throw new Error(`Invalid subdomain format: ${subdomain}`);
        }

        const serviceName = subdomain
            ? `${projectName}-${subdomain.replace(/\./g, "-")}`
            : projectName;
        const containerName = subdomain
            ? `${projectName}-${subdomain.replace(/\./g, "-")}`
            : projectName;
        const fqdn = subdomain
            ? `${subdomain}.stackforgeengine.com`
            : `${projectName}.stackforgeengine.com`;

        const checkTargetGroupHealth = async () => {
            const { TargetHealthDescriptions } = await elbClient.send(
                new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn })
            );
            const healthy = TargetHealthDescriptions.length > 0 &&
                TargetHealthDescriptions.every(t => t.TargetHealth.State === "healthy");
            const draining = TargetHealthDescriptions.filter(
                t => t.TargetHealth.State === "draining"
            );
            return { healthy, draining, targets: TargetHealthDescriptions };
        };

        const cleanTargetGroup = async () => {
            const { TargetHealthDescriptions } = await elbClient.send(
                new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn })
            );
            const drainingTargets = TargetHealthDescriptions.filter(
                t => t.TargetHealth.State === "draining" && t.Target.Id
            );
            if (drainingTargets.length) {
                await elbClient.send(new DeregisterTargetsCommand({
                    TargetGroupArn: targetGroupArn,
                    Targets: drainingTargets.map(t => ({
                        ID: t.Target.Id,
                        Port: t.Target.Port
                    }))
                }));
                let round = 0;
                while (true) {
                    round++;
                    const { draining } = await checkTargetGroupHealth();
                    if (!draining.length) {
                        break;
                    }
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        };

        const validateTargetCount = async (taskArns) => {
            let backoff = 5000;
            let round = 0;

            while (true) {
                round++;
                let health;
                try {
                    health = await checkTargetGroupHealth();
                } catch (error) {
                    if (isRateLimitError(error)) {
                        await new Promise((r) => setTimeout(r, backoff));
                        backoff = Math.min(backoff * 2, 30000);
                        continue;
                    }
                    throw err;
                }

                const { targets } = health;
                const actual = targets.length;
                const desired = taskArns.length;

                if (actual > desired) {
                    const healthyExtras = targets
                        .filter(
                            (t) => t.TargetHealth.State === "healthy" && t.Target.Id
                        )
                        .slice(0, actual - desired);

                    if (healthyExtras.length) {
                        try {
                            await elbClient.send(
                                new DeregisterTargetsCommand({
                                    TargetGroupArn: targetGroupArn,
                                    Targets: healthyExtras.map((t) => ({
                                        ID: t.Target.Id,
                                        Port: t.Target.Port,
                                    })),
                                })
                            );
                        } catch (error) {
                            if (isRateLimitError(error)) {
                                await new Promise((r) => setTimeout(r, backoff));
                                backoff = Math.min(backoff * 2, 30000);
                                continue;
                            }
                            throw err;
                        }
                        continue;
                    } else {
                        await new Promise((r) => setTimeout(r, 5000));
                        continue;
                    }
                }

                if (actual === desired) {
                    break;
                }

                await new Promise((r) => setTimeout(r, 5000));
            }
        };

        const checkStickySessions = async () => {
            try {
                const { TargetGroupAttributes = [] } =
                    await elbClient.send(
                        new DescribeTargetGroupAttributesCommand({ TargetGroupArn: targetGroupArn })
                    );

                const enabled = TargetGroupAttributes.some(
                    (a) => a.Key === "stickiness.enabled" && a.Value === "true"
                );

            } catch (error) { }
        };

        const pickPriority = async (listenerArn) => {
            const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
            const used = new Set(Rules.filter(r => !r.IsDefault).map(r => parseInt(r.Priority, 10)));
            for (let p = 1; p <= 50000; p++) if (!used.has(p)) return p;
            throw new Error("No free ALB priority available.");
        };

        const updateALBRules = async () => {
            const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
            const normalizedFqdn = fqdn.toLowerCase();
            const { Rules } = await elbClient.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));

            const redirectRule = Rules.find(r =>
                !r.IsDefault &&
                r.Actions[0].Type === "redirect" &&
                r.Conditions.some(c => c.Field === "host-header" &&
                    c.Values.map(v => v.toLowerCase()).includes(normalizedFqdn))
            );

            const forwardRules = Rules.filter(r =>
                !r.IsDefault &&
                r.Actions[0].Type === "forward" &&
                r.Conditions.some(c => c.Field === "host-header" &&
                    c.Values.map(v => v.toLowerCase()).includes(normalizedFqdn))
            );

            const correctForward = forwardRules.find(r => r.Actions[0].TargetGroupArn === targetGroupArn);

            if (redirectRule) {
                for (const r of forwardRules) {
                    if (r.Actions[0].TargetGroupArn !== targetGroupArn) {
                        await elbClient.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
                    }
                }

                if (!correctForward) {
                    let priority = 50000;
                    const used = new Set(Rules.filter(r => !r.IsDefault).map(r => Number(r.Priority)));
                    while (used.has(priority)) priority += 1;

                    await elbClient.send(new CreateRuleCommand({
                        ListenerArn: listenerArn,
                        Priority: priority,
                        Conditions: [{ Field: "host-header", Values: [fqdn] }],
                        Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
                    }));
                }
                return;
            }

            for (const r of forwardRules) {
                if (r.Actions[0].TargetGroupArn !== targetGroupArn) {
                    await elbClient.send(new DeleteRuleCommand({ RuleArn: r.RuleArn }));
                }
            }

            if (correctForward) {
                return;
            }

            const priority = await pickPriority(listenerArn);
            await elbClient.send(new CreateRuleCommand({
                ListenerArn: listenerArn,
                Priority: priority,
                Conditions: [{ Field: "host-header", Values: [fqdn] }],
                Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }]
            }));
        };

        const verifyApplicationResponse = async () => {
            try {
                const response = await new Promise((resolve, reject) => {
                    const req = https.get(`https://${fqdn}`, res => {
                        let data = "";
                        res.on("data", chunk => data += chunk);
                        res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
                    });
                    req.on("error", reject);
                    req.end();
                });
                return response;
            } catch (error) {
                return null;
            }
        };

        const td = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn }));
        let cont = td.taskDefinition.containerDefinitions.find(c => c.name === containerName);
        if (!cont) {
            cont = td.taskDefinition.containerDefinitions[0];
            if (!cont) throw new Error(`No containers in task definition ${taskDefArn}.`);
        }
        cont.environment = (cont.environment || []).map(e => ({
            ...e,
            value: typeof e.value === "string" ? e.value.replace(/^['"]|['"]$/g, "") : e.value
        }));
        if (!cont.environment.some(e => e.name === "CACHE_CONTROL")) {
            cont.environment.push({ name: "CACHE_CONTROL", value: "no-cache, no-store, must-revalidate" });
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
            healthCheckGracePeriodSeconds: 120
        };

        await checkStickySessions();
        await cleanTargetGroup();

        const { services } = await ecsClient.send(new DescribeServicesCommand({
            cluster: process.env.ECS_CLUSTER_ARN,
            services: [serviceName]
        }));
        const existing = services?.[0];

        if (existing && existing.status === "ACTIVE") {
            await ecsClient.send(new UpdateServiceCommand({ ...svcBase, service: serviceName, forceNewDeployment: true }));
            await waitUntilServicesStable(
                { client: ecsClient, maxWaitTime: 1200, minDelay: 15, maxDelay: 60 },
                { cluster: process.env.ECS_CLUSTER_ARN, services: [serviceName] }
            );
        } else {
            if (existing) {
                try {
                    await ecsClient.send(new DeleteServiceCommand({
                        cluster: process.env.ECS_CLUSTER_ARN,
                        service: serviceName,
                        force: true
                    }));
                } catch (error) { }
            }
            await ecsClient.send(new CreateServiceCommand({ ...svcBase, serviceName, launchType: "FARGATE" }));
            await waitUntilServicesStable(
                { client: ecsClient, maxWaitTime: 1200, minDelay: 15, maxDelay: 60 },
                { cluster: process.env.ECS_CLUSTER_ARN, services: [serviceName] }
            );
        }

        const serviceDesc = await ecsClient.send(new DescribeServicesCommand({
            cluster: process.env.ECS_CLUSTER_ARN,
            services: [serviceName]
        }));
        const service = serviceDesc.services?.[0];
        if (!service || service.status !== "ACTIVE" || service.runningCount < 1) {
            throw new Error(`Service ${serviceName} is not healthy`);
        }

        let taskArns = [];
        try {
            const listTasks = await ecsClient.send(new ListTasksCommand({
                cluster: process.env.ECS_CLUSTER_ARN,
                serviceName
            }));
            taskArns = listTasks.taskArns || [];
        } catch (error) { }

        let round2 = 0;
        while (true) {
            round2++;
            const { healthy, draining } = await checkTargetGroupHealth();
            if (healthy) {
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
        }

        try {
            const fresh = await ecsClient.send(new ListTasksCommand({
                cluster: process.env.ECS_CLUSTER_ARN,
                serviceName
            }));
            taskArns = fresh.taskArns || [];
        } catch { }

        await validateTargetCount(taskArns);
        await updateALBRules();
        await verifyApplicationResponse();

        if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
            let success = false, invalidationID = null;
            const ref = `ecs-${serviceName}-${Date.now()}`;
            for (let a = 1; a <= 3; a++) {
                try {
                    const { Invalidation } = await cfClient.send(new CreateInvalidationCommand({
                        DistributionID: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                        InvalidationBatch: {
                            CallerReference: ref,
                            Paths: { Quantity: 4, Items: ["/", "/*", "/*/*", "/assets/*"] }
                        }
                    }));
                    invalidationID = Invalidation.Id;
                    success = true;
                    break;
                } catch (error) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            if (success && invalidationID) {
                let retries = 10;
                while (retries--) {
                    try {
                        const { Invalidation } = await cfClient.send(new GetInvalidationCommand({
                            DistributionID: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                            ID: invalidationID
                        }));
                        if (Invalidation.Status === "Completed") break;
                    } catch { }
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
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
        if (!repository?.trim()) throw new Error("repository is required");
        if (!githubAccessToken?.trim()) throw new Error("GitHub token missing");
        await this.validateGitHubToken(githubAccessToken, repository);

        const repoUrl = /^https?:\/|^git@/.test(repository) ? repository : `https://github.com/${repository.replace(/^\/|\/$/g, "")}.git`;
        const rootDir = rootDirectory || ".";
        const imageTag = subdomain
            ? `${subdomain.replace(/\./g, "-")}-${await this.getLatestCommitSha(
                repository, branch, githubAccessToken)}`
            : "latest";
        const repoUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}`;
        const cbName = subdomain ? `${projectName}-${subdomain.replace(/\./g, "-")}` : projectName;

        const activeCbNames = new Set();
        try {
            const projRes = await pool.query("SELECT project_id, name FROM projects");
            const projectMap = new Map();
            projRes.rows.forEach(r => {
                if (r.project_id && r.name) {
                    projectMap.set(r.project_id, r.name);
                    activeCbNames.add(r.name);
                }
            });

            if (projectMap.size > 0) {
                const projectIDs = Array.from(projectMap.keys());
                const domainRes = await pool.query(
                    `SELECT project_id, domain_name 
                    FROM domains 
                    WHERE project_id = ANY($1)`,
                    [projectIDs]
                );
                domainRes.rows.forEach(r => {
                    const projName = projectMap.get(r.project_id);
                    if (projName && r.domain_name) {
                        const sanitizedSub = r.domain_name.replace(/\./g, "-");
                        activeCbNames.add(`${projName}-${sanitizedSub}`);
                    }
                });
            }
        } catch (error) {
            activeCbNames.clear();
            activeCbNames.add(cbName);
        }

        const listResp = await codeBuildClient.send(new ListProjectsCommand({}));
        const allNames = listResp.projects || [];
        const inactiveProjects = allNames.filter(n => !activeCbNames.has(n));

        const MAX_SAFE_CB_PROJECTS = 450;
        if (allNames.length >= MAX_SAFE_CB_PROJECTS) {
            const projectDetails = [];
            const BatchGetProjects = require("@aws-sdk/client-codebuild").BatchGetProjectsCommand;
            for (let i = 0; i < inactiveProjects.length; i += 100) {
                const slice = inactiveProjects.slice(i, i + 100);
                try {
                    const batchResp = await codeBuildClient.send(new BatchGetProjects({ names: slice }));
                    (batchResp.projects || []).forEach(proj => {
                        projectDetails.push({
                            name: proj.name,
                            lastModified: proj.lastModified
                        });
                    });
                } catch (error) { }
            }

            projectDetails.sort((a, b) => {
                return new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime();
            });

            const toDeleteCount = allNames.length - (MAX_SAFE_CB_PROJECTS - 1);
            let deletedCount = 0;
            for (let i = 0; i < projectDetails.length && deletedCount < toDeleteCount; i++) {
                const toDelete = projectDetails[i].name;
                try {
                    await codeBuildClient.send(
                        new (require("@aws-sdk/client-codebuild").DeleteProjectCommand)({ name: toDelete })
                    );
                    deletedCount += 1;
                } catch (error) { }
            }

            if (deletedCount < toDeleteCount) {
                throw new Error(
                    `Cannot prune enough CodeBuild projects: Only ${deletedCount} inactive projects ` +
                    `found, but need to delete ${toDeleteCount}. Consider manual cleanup or requesting a quota increase.`
                );
            }
        }

        const buildspec = {
            version: "0.2",
            env: { variables: { DOCKER_BUILDKIT: "1" } },
            phases: {
                install: {
                    "runtime-versions": { nodejs: "20" },
                    commands: ['echo "Install phase ready"']
                },
                pre_build: {
                    commands: [
                        'git config --global credential.helper "!f() { echo username=x-oauth-basic; echo password=$GITHUB_TOKEN; }; f"',
                        'git clone --depth 1 --branch $REPO_BRANCH $REPO_URL $CODEBUILD_SRC_DIR',
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        installCommand || "npm ci --prefer-offline --no-audit"
                    ]
                },
                build: { commands: ['echo "No extra app build"'] },
                post_build: {
                    commands: [
                        `cd $CODEBUILD_SRC_DIR/$ROOT_DIRECTORY`,
                        'echo "Injecting monitoring script into HTML files"',
                        `find . -type f -name '*.html' -exec sed -i 's|</head>|<script src="http://localhost:3000/z-analytics-inject.js"></script></head>|g' {} \\;`,
                        'cat > Dockerfile <<EOF\n' +
                        'FROM node:20-slim AS deps\n' +
                        'WORKDIR /app\n' +
                        'COPY package*.json ./\n' +
                        'RUN npm ci --omit=dev --prefer-offline --no-audit\n' +
                        '\n' +
                        'FROM node:20-slim\n' +
                        'WORKDIR /app\n' +
                        'COPY --from=deps /app/node_modules ./node_modules\n' +
                        'COPY . .\n' +
                        'CMD ["node","api/index.js"]\n' +
                        'EOF',
                        '[ "$DOCKER_HUB_USERNAME" ] && [ "$DOCKER_HUB_PASSWORD" ] && ' +
                        'echo "$DOCKER_HUB_PASSWORD" | docker login --username "$DOCKER_HUB_USERNAME" --password-stdin || true',
                        'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO_URI',
                        'docker pull $REPO_URI:latest || true',
                        `docker build --progress=plain ` +
                        `--build-arg BUILDKIT_INLINE_CACHE=1 ` +
                        `--cache-from=$REPO_URI:latest ` +
                        `-t $REPO_URI:${imageTag} .`,
                        `docker push $REPO_URI:${imageTag}`,
                        `docker tag $REPO_URI:${imageTag} $REPO_URI:latest`,
                        'docker push $REPO_URI:latest'
                    ]
                }
            },
            artifacts: { files: [], "discard-paths": "yes" }
        };

        const envVars = [
            { name: "ROOT_DIRECTORY", value: rootDir, type: "PLAINTEXT" },
            { name: "REPO_URI", value: repoUri, type: "PLAINTEXT" },
            { name: "AWS_REGION", value: process.env.AWS_REGION, type: "PLAINTEXT" },
            { name: "GITHUB_TOKEN", value: githubAccessToken, type: "PLAINTEXT" },
            { name: "REPO_URL", value: repoUrl, type: "PLAINTEXT" },
            { name: "REPO_BRANCH", value: branch, type: "PLAINTEXT" },
            { name: "IMAGE_TAG", value: imageTag, type: "PLAINTEXT" },
            { name: "DOCKER_HUB_USERNAME", value: process.env.DOCKER_HUB_USERNAME || "", type: "PLAINTEXT" },
            { name: "DOCKER_HUB_PASSWORD", value: process.env.DOCKER_HUB_PASSWORD || "", type: "PLAINTEXT" }
        ];

        const params = {
            name: cbName,
            source: { type: "NO_SOURCE", buildspec: JSON.stringify(buildspec) },
            artifacts: { type: "NO_ARTIFACTS" },
            environment: {
                type: "LINUX_CONTAINER",
                image: "aws/codebuild/standard:7.0",
                computeType: "BUILD_GENERAL1_MEDIUM",
                environmentVariables: envVars,
                privilegedMode: true
            },
            cache: { type: "LOCAL", modes: ["LOCAL_DOCKER_LAYER_CACHE"] },
            serviceRole: process.env.CODEBUILD_ROLE_ARN,
            logsConfig: {
                cloudWatchLogs: {
                    status: "ENABLED",
                    groupName: `/aws/codebuild/${cbName}`
                }
            }
        };

        try {
            await codeBuildClient.send(new CreateProjectCommand(params));
        } catch (error) {
            if (error.name === "ResourceAlreadyExistsException") {
                await codeBuildClient.send(new UpdateProjectCommand(params));
            } else if (error.name === "TooManyProjectsException" || error.name === "TooManyProjects") {
                throw new Error(
                    "TooManyCodeBuildProjects: unable to create new project even after pruning inactive ones. " +
                    "Consider requesting a CodeBuild quota increase."
                );
            } else {
                throw new Error(`Failed to create CodeBuild project: ${error.message}.`);
            }
        }

        if (subdomain) {
            await pool.query(
                `
                    UPDATE domains SET image_tag = $1
                    WHERE domain_name = $2
                    AND project_id = (SELECT project_id FROM projects WHERE name = $3)
                `,
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
        } catch (_) { }

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
        const buildID = startResp.build.id;

        let logStreamName = startResp.build.logs?.cloudWatchLogs?.logStreamName || null;
        if (!logStreamName) {
            for (let i = 0; i < 10 && !logStreamName; i++) {
                await new Promise(r => setTimeout(r, 3000));
                const info = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildID] }));
                logStreamName = info.builds?.[0]?.logs?.cloudWatchLogs?.logStreamName || null;
            }
        }

        if (!logStreamName) logStreamName = buildID.split(":")[1];

        if (!logStreamName) {
            throw new Error("CodeBuild did not return a CloudWatch log-stream name.");
        }

        const logFile = path.join(logDir, `codebuild-${buildID.replace(/:/g, "-")}.log`);
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

            const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildID] }));
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

        const buildID = build.build.id;
        const cbLogStreamName = build.build.logs?.cloudWatchLogs?.logStreamName
            || buildID.split(":")[1];
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

            const buildInfo = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildID] }));
            buildStatus = buildInfo.builds?.[0]?.buildStatus || "UNKNOWN";
            await new Promise(r => setTimeout(r, 3000));
        }

        if (buildStatus === "SUCCEEDED") {
            const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${projectName}:${imageTag}`;
            onChunk(`Build OK → ${imageUri}\n`);
            return imageUri;
        }

        const info = await codeBuildClient.send(new BatchGetBuildsCommand({ ids: [buildID] }));
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
        deploymentID
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
            [rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), deploymentID]
        );
        return logDir;
    }

    async cloneAndBuildStream(
        { repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, envVars, projectName, deploymentID },
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
                `
                    UPDATE deployments 
                    SET root_directory = $1, output_directory = $2, build_command = $3, install_command = $4, env_vars = $5
                    WHERE deployment_id = $6
                `,
                [rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), deploymentID]
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
        deploymentID,
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
                `
                    SELECT repository,branch,root_directory,install_command, build_command,env_vars
                    FROM domains
                    WHERE domain_name=$1
                        AND project_id=(SELECT project_id FROM projects WHERE name=$2)
                `,
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
        envVars,
        deploymentProtection = false,
        deploymentAuthentication = false
    }) {
        const deploymentID = uuidv4();
        const timestamp = new Date().toUTCString();
        const logDir = path.join("/tmp", `${projectName}-${uuidv4()}`, "logs");
        fs.mkdirSync(logDir, { recursive: true });
        let projectID;
        let isNewProject = false;
        const domainIDs = {};

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
            let domainID;
            let domainDetails = { repository, branch, rootDirectory, installCommand, buildCommand, envVars };
            if (subdomain !== projectName) {
                const domainResult = await pool.query(
                    `
                        SELECT repository, branch, root_directory, install_command, build_command, env_vars
                        FROM domains
                        WHERE domain_name = $1 AND project_id = (SELECT project_id FROM projects WHERE name = $2)
                    `,
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
                    domainID = existingDomainResult.rows[0].domain_id;
                    await pool.query(
                        `
                            UPDATE domains
                            SET updated_at = $1, 
                                deployment_id = $2, 
                                repository = $3, 
                                branch = $4, 
                                root_directory = $5, 
                                output_directory = $6, 
                                build_command = $7, 
                                install_command = $8, 
                                env_vars = $9,
                                deployment_protection = $10, 
                                deployment_authentication = $11
                            WHERE domain_id = $12
                        `,
                        [
                            timestamp,
                            deploymentID,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars),
                            deploymentProtection,
                            deploymentAuthentication,
                            domainID
                        ]
                    );
                } else {
                    domainID = uuidv4();
                    await pool.query(
                        `
                            INSERT INTO domains 
                                (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars, deployment_protection, deployment_authentication) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                        `,
                        [
                            organizationID,
                            userID,
                            domainID,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            deploymentID,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars),
                            deploymentProtection,
                            deploymentAuthentication
                        ]
                    );
                }
                domainIDs[subdomain] = domainID;
            } else {
                domainID = uuidv4();
                domainIDs[subdomain] = domainID;
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
                `
                    UPDATE deployments 
                    SET root_directory = $1, build_command = $2, install_command = $3, env_vars = $4
                    WHERE deployment_id = $5
                `,
                [domainDetails.rootDirectory, domainDetails.buildCommand, domainDetails.installCommand, JSON.stringify(domainDetails.envVars), deploymentID]
            );

            if (subdomain !== projectName) {
                await pool.query(
                    `
                        UPDATE domains
                        SET repository = $1, 
                            branch = $2, 
                            root_directory = $3, 
                            install_command = $4, 
                            build_command = $5, 
                            env_vars = $6,
                            deployment_protection = $7, 
                            deployment_authentication = $8
                        WHERE domain_name = $9 AND project_id = (SELECT project_id FROM projects WHERE name = $10)
                    `,
                    [
                        domainDetails.repository,
                        domainDetails.branch,
                        domainDetails.rootDirectory,
                        domainDetails.installCommand,
                        domainDetails.buildCommand,
                        JSON.stringify(domainDetails.envVars),
                        deploymentProtection,
                        deploymentAuthentication,
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
                    `
                        INSERT INTO projects 
                            (orgid, username, project_id, name, description, branch, team_name, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image) 
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                    `,
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
                        deploymentID,
                        null
                    ]
                );

                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    const domainID = domainIDs[subdomain];
                    await pool.query(
                        `
                            INSERT INTO domains 
                                (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars, deployment_protection, deployment_authentication, dns_records) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                        `,
                        [
                            organizationID,
                            userID,
                            domainID,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            deploymentID,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars),
                            deploymentProtection,
                            deploymentAuthentication,
                            JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || [])
                        ]
                    );
                }

                await pool.query(
                    `
                        INSERT INTO deployments 
                            (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    `,
                    [
                        organizationID,
                        userID,
                        deploymentID,
                        projectID,
                        domainIDs[domainNames[0]],
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
                    `
                        INSERT INTO deployment_logs 
                            (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        "launch",
                        deploymentID,
                        timestamp,
                        "127.0.0.1"
                    ]
                );
            } else {
                const now = new Date().toUTCString();
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                    ["inactive", now, projectID, "active"]
                );

                await pool.query(
                    `
                        INSERT INTO deployments 
                            (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    `,
                    [
                        organizationID,
                        userID,
                        deploymentID,
                        projectID,
                        domainIDs[domainNames[0]],
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
                        "UPDATE domains SET dns_records = $1, deployment_protection = $2, deployment_authentication = $3 WHERE domain_id = $4",
                        [JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || []), deploymentProtection, deploymentAuthentication, domainIDs[subdomain]]
                    );
                }
            }

            await this.recordBuildLogs(organizationID, userID, deploymentID, logDir);
            await this.recordRuntimeLogs(organizationID, userID, deploymentID, projectName);
            return { urls, deploymentID, logPath: logDir, taskDefArns };
        } catch (error) {
            await this.cleanupFailedDeployment({
                organizationID,
                userID,
                projectID,
                projectName,
                domainName: domainNames[0],
                deploymentID,
                domainID: domainIDs[domainNames[0]],
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
        const deploymentID = uuidv4();
        const timestamp = new Date().toUTCString();
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
        const domainIDs = {};

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
            let domainID;

            if (!isNewProject) {
                onData(`Checking for existing domain: ${subdomain}\n`);
                const existingDomainResult = await pool.query(
                    "SELECT domain_id FROM domains WHERE project_id = $1 AND domain_name = $2",
                    [projectID, subdomain]
                );
                if (existingDomainResult.rows.length > 0) {
                    domainID = existingDomainResult.rows[0].domain_id;
                    onData(`Existing domain found, ID: ${domainID}\n`);
                    await pool.query(
                        `
                            UPDATE domains
                            SET updated_at = $1, deployment_id = $2, repository = $3, branch = $4, root_directory = $5, output_directory = $6, build_command = $7, install_command = $8, env_vars = $9
                            WHERE domain_id = $10
                        `,
                        [timestamp, deploymentID, repository, branch, rootDirectory, outputDirectory, buildCommand, installCommand, JSON.stringify(envVars), domainID]
                    );
                    onData(`Updated domain timestamp and deployment_id\n`);
                } else {
                    domainID = uuidv4();
                    await pool.query(
                        `
                            INSERT INTO domains 
                                (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                        `,
                        [
                            organizationID,
                            userID,
                            domainID,
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            subdomain === projectName,
                            deploymentID,
                            repository,
                            branch,
                            rootDirectory,
                            outputDirectory,
                            buildCommand,
                            installCommand,
                            JSON.stringify(envVars)
                        ]
                    );
                    onData(`Created new domain, ID: ${domainID}\n`);
                }
                domainIDs[subdomain] = domainID;
            } else {
                domainID = uuidv4();
                domainIDs[subdomain] = domainID;
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
                    `
                        INSERT INTO projects 
                            (orgid, username, project_id, name, description, branch, team_name, created_by, created_at, updated_at, url, repository, previous_deployment, current_deployment, image)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                    `,
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
                        deploymentID,
                        null
                    ]
                );
                onData(`Project record created\n`);

                for (const domainName of domainNames) {
                    const subdomain = domainName.includes(`.${projectName}`) ? domainName.split(`.${projectName}`)[0] : domainName;
                    await pool.query(
                        `
                            INSERT INTO domains 
                                (orgid, username, domain_id, domain_name, project_id, created_by, created_at, updated_at, environment, is_primary, deployment_id, repository, branch, root_directory, output_directory, build_command, install_command, env_vars, dns_records) 
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                        `,
                        [
                            organizationID,
                            userID,
                            domainIDs[subdomain],
                            subdomain,
                            projectID,
                            userID,
                            timestamp,
                            timestamp,
                            "production",
                            subdomain === projectName,
                            deploymentID,
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
                    `
                        INSERT INTO deployments 
                            (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    `,
                    [
                        organizationID,
                        userID,
                        deploymentID,
                        projectID,
                        domainIDs[domainNames[0]],
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
                    `
                        INSERT INTO deployment_logs 
                            (orgid, username, project_id, project_name, action, deployment_id, timestamp, ip_address) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `,
                    [
                        organizationID,
                        userID,
                        projectID,
                        projectName,
                        "launch",
                        deploymentID,
                        timestamp,
                        "127.0.0.1"
                    ]
                );
                onData(`Deployment log created\n`);
            } else {
                const now = new Date().toUTCString();
                onData(`Updating deployment status to active\n`);
                await pool.query(
                    "UPDATE deployments SET status = $1, updated_at = $2 WHERE project_id = $3 AND status = $4",
                    ["inactive", now, projectID, "active"]
                );
                await pool.query(
                    `
                        INSERT INTO deployments 
                            (orgid, username, deployment_id, project_id, domain_id, status, url, template, created_at, updated_at, last_deployed_at, task_def_arn, commit_sha, root_directory, output_directory, build_command, install_command, env_vars) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    `,
                    [
                        organizationID,
                        userID,
                        deploymentID,
                        projectID,
                        domainIDs[domainNames[0]],
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
                        [JSON.stringify(records[`${subdomain}.stackforgeengine.com`] || []), domainIDs[subdomain]]
                    );
                }
                onData(`Deployment status updated\n`);
            }

            onData(`Recording build logs\n`);
            await this.recordBuildLogs(organizationID, userID, deploymentID, logDir, streamBuffer);
            onData(`Build logs recorded\n`);
            onData(`Recording runtime logs\n`);
            await this.recordRuntimeLogs(organizationID, userID, deploymentID, projectName);
            onData(`Runtime logs recorded\n`);
            return { urls, deploymentID, logPath: logDir, taskDefArns };
        } catch (error) {
            onData(`Deployment failed: ${error.message}\n`);
            await this.cleanupFailedDeployment({
                organizationID,
                userID,
                projectID,
                projectName,
                domainName: domainNames[0],
                deploymentID,
                domainID: domainIDs[domainNames[0]],
                certificateArn: null,
                targetGroupArn: null
            });
            throw error;
        }
    }

    async recordBuildLogs(orgid, username, deploymentID, logDir, streamBuffer = "") {
        let fileLogs = "";
        try {
            const files = fs.readdirSync(logDir).filter(f => f.endsWith(".log"));
            for (const f of files) {
                fileLogs += fs.readFileSync(path.join(logDir, f), "utf-8") + "\n";
                await s3Client.send(new PutObjectCommand({
                    Bucket: process.env.S3_LOGS_BUCKET_NAME,
                    Key: `build-logs/${deploymentID}/${f}`,
                    Body: fs.readFileSync(path.join(logDir, f))
                }));
            }
        } catch (error) {
            fileLogs = `Error reading log files: ${error.message}\n`;
        }
        const combined = fileLogs + streamBuffer;
        await pool.query(
            `
                INSERT INTO build_logs 
                    (orgid, username, deployment_id, build_log_id, timestamp, log_path, log_messages)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
            `,
            [
                orgid,
                username,
                deploymentID,
                uuidv4(),
                new Date().toUTCString(),
                `s3://${process.env.S3_LOGS_BUCKET_NAME}/build-logs/${deploymentID}`,
                combined
            ]
        );
    }

    async recordRuntimeLogs(orgid, username, deploymentID, projectName, subdomain) {
        const timestamp = new Date().toUTCString();
        try {
            const taskFamily = subdomain
                ? `${projectName}-${subdomain.replace(/\./g, '-')}`
                : projectName;
            const logGroupName = `/ecs/${taskFamily}`;
            const logStreamName = `ecs/${projectName}-${deploymentID}`;

            await this.ensureLogGroup(logGroupName);

            try {
                await cloudWatchLogsClient.send(new CreateLogStreamCommand({
                    logGroupName,
                    logStreamName
                }));
            } catch (error) { }

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
                    if (error.name === "ResourceNotFoundException" && attempt < 5) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    } else {
                        throw new Error(`Failed to fetch logs: ${error.message}.`);
                    }
                }
            }

            const logMessages = events.map(e => ({ timestamp: e.timestamp, message: e.message }));
            for (const log of logMessages) {
                if (log.message.includes("200 OK")) break;
                if (log.message.includes("500 Internal Server Error")) break;
            }

            const runtimeLogPath = `runtime-logs/${deploymentID}/${uuidv4()}.log`;
            const logContent = JSON.stringify(logMessages, null, 2);
            try {
                await s3Client.send(new PutObjectCommand({
                    Bucket: process.env.S3_LOGS_BUCKET_NAME,
                    Key: runtimeLogPath,
                    Body: logContent
                }));
            } catch (error) { }

            const logID = uuidv4();
            await pool.query(`
                INSERT INTO runtime_logs 
                  (orgid, username, deployment_id, build_log_id, timestamp, runtime_messages, runtime_path)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                orgid,
                username,
                deploymentID,
                logID,
                timestamp,
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
            ? process.env.LOAD_BALANCER_DNS
            : `${process.env.LOAD_BALANCER_DNS}.`;
        if (!hostedZoneId || !albZoneId || !albDns) {
            throw new Error("Route-53 / ALB env vars are missing.");
        }

        projectName = projectName.toLowerCase();

        const fqdnSet = new Set();
        (Array.isArray(subdomains) ? subdomains : []).forEach((raw) => {
            const s = raw.trim().toLowerCase();
            if (!s) return;
            const fqdn =
                s === projectName
                    ? `${projectName}.stackforgeengine.com`
                    : `${s}.stackforgeengine.com`;
            fqdnSet.add(fqdn);
        });
        const fqdnList = Array.from(fqdnSet);
        const wildcardSubdomain = `*.${projectName}.stackforgeengine.com`;

        let certificateArn =
            process.env.CERTIFICATE_ARN ||
            "arn:aws:acm:us-east-1:913524945973:certificate/d84f519d-2502-477f-8512-3d060065ed78";
        const { Certificate } = await acmClient.send(
            new DescribeCertificateCommand({ CertificateArn: certificateArn })
        );
        const certDomains = Certificate.SubjectAlternativeNames || [];

        if (
            !certDomains.includes(wildcardSubdomain) &&
            fqdnList.some((fqdn) => fqdn !== `${projectName}.stackforgeengine.com`)
        ) {
            try {
                const certResponse = await acmClient.send(
                    new RequestCertificateCommand({
                        DomainName: `${projectName}.stackforgeengine.com`,
                        SubjectAlternativeNames: [
                            `${projectName}.stackforgeengine.com`,
                            wildcardSubdomain,
                        ],
                        ValidationMethod: "DNS",
                    })
                );
                certificateArn = certResponse.CertificateArn;

                for (let i = 0; i < 30; i++) {
                    const desc = await acmClient.send(
                        new DescribeCertificateCommand({ CertificateArn: certificateArn })
                    );
                    const domainValidation = desc.Certificate.DomainValidationOptions?.find(
                        (opt) => opt.DomainName === wildcardSubdomain
                    );
                    if (domainValidation?.ResourceRecord) {
                        await route53Client.send(
                            new ChangeResourceRecordSetsCommand({
                                HostedZoneId: hostedZoneId,
                                ChangeBatch: {
                                    Changes: [
                                        {
                                            Action: "UPSERT",
                                            ResourceRecordSet: {
                                                Name: domainValidation.ResourceRecord.Name,
                                                Type: domainValidation.ResourceRecord.Type,
                                                TTL: 300,
                                                ResourceRecords: [
                                                    { Value: domainValidation.ResourceRecord.Value },
                                                ],
                                            },
                                        },
                                    ],
                                },
                            })
                        );
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                }

                for (let i = 0; i < 60; i++) {
                    const desc = await acmClient.send(
                        new DescribeCertificateCommand({ CertificateArn: certificateArn })
                    );
                    if (desc.Certificate.Status === "ISSUED") {
                        break;
                    }
                    if (desc.Certificate.Status === "FAILED") {
                        throw new Error(`Certificate issuance failed: ${desc.Certificate.FailureReason}.`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 10000));
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
                        StartRecordIdentifier: next?.id,
                    })
                );
                for (const rec of list.ResourceRecordSets) {
                    if (rec.Name.replace(/\.$/, "") !== fqdn) break;
                    deletesMap.set(`${rec.Name}|${rec.Type}`, {
                        Action: "DELETE",
                        ResourceRecordSet: rec,
                    });
                }
                next = list.IsTruncated
                    ? {
                        name: list.NextRecordName,
                        type: list.NextRecordType,
                        id: list.NextRecordIdentifier,
                    }
                    : null;
            } while (next);
        }

        const upsertsMap = new Map();
        for (const fqdn of fqdnList) {
            const apex = fqdn === `${projectName}.stackforgeengine.com`;
            const rec = apex
                ? {
                    Name: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                    Type: "A",
                    AliasTarget: {
                        HostedZoneId: albZoneId,
                        DNSName: albDns,
                        EvaluateTargetHealth: false,
                    },
                }
                : {
                    Name: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                    Type: "CNAME",
                    TTL: 30,
                    ResourceRecords: [{ Value: `${projectName}.stackforgeengine.com.` }],
                };
            upsertsMap.set(`${rec.Name}|${rec.Type}`, {
                Action: "UPSERT",
                ResourceRecordSet: rec,
            });
        }

        for (const k of upsertsMap.keys()) {
            const del = deletesMap.get(k);
            if (
                del &&
                JSON.stringify(del.ResourceRecordSet) ===
                JSON.stringify(upsertsMap.get(k).ResourceRecordSet)
            ) {
                deletesMap.delete(k);
                upsertsMap.delete(k);
            }
        }

        const sendBatch = async (changes) => {
            if (changes.length === 0) return;
            try {
                await route53Client.send(
                    new ChangeResourceRecordSetsCommand({
                        HostedZoneId: hostedZoneId,
                        ChangeBatch: { Changes: changes },
                    })
                );
            } catch (error) {
                throw error;
            }
        };
        const delArr = Array.from(deletesMap.values());
        for (let i = 0; i < delArr.length; i += 100)
            await sendBatch(delArr.slice(i, i + 100));
        const upArr = Array.from(upsertsMap.values());
        for (let i = 0; i < upArr.length; i += 100)
            await sendBatch(upArr.slice(i, i + 100));

        for (const fqdn of fqdnList) {
            try {
                const { ResourceRecordSets } = await route53Client.send(
                    new ListResourceRecordSetsCommand({
                        HostedZoneId: hostedZoneId,
                        StartRecordName: fqdn.endsWith(".") ? fqdn : `${fqdn}.`,
                        MaxItems: 1,
                    })
                );
                const record = ResourceRecordSets.find(
                    (rec) => rec.Name.replace(/\.$/, "") === fqdn
                );
            } catch (error) { }
        }

        if (targetGroupArn) {
            const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
            const pickPriority = async () => {
                const { Rules } = await elbClient.send(
                    new DescribeRulesCommand({ ListenerArn: listenerArn })
                );
                const used = new Set(
                    Rules.filter((r) => !r.IsDefault).map((r) => parseInt(r.Priority, 10))
                );
                for (let p = 1; p <= 50000; p++) if (!used.has(p)) return p;
                throw new Error("No free ALB priority.");
            };

            for (const fqdn of fqdnList) {
                const ruleExists = async () => {
                    const { Rules } = await elbClient.send(
                        new DescribeRulesCommand({ ListenerArn: listenerArn })
                    );
                    const rule = Rules.find(
                        (r) =>
                            !r.IsDefault &&
                            r.Conditions.some(
                                (c) => c.Field === "host-header" && c.Values.includes(fqdn)
                            ) &&
                            r.Actions.some(
                                (a) => a.Type === "forward" && a.TargetGroupArn === targetGroupArn
                            )
                    );
                    return rule ? rule.RuleArn : null;
                };

                const existingRuleArn = await ruleExists();
                if (existingRuleArn) {
                    await elbClient.send(
                        new ModifyRuleCommand({
                            RuleArn: existingRuleArn,
                            Conditions: [{ Field: "host-header", Values: [fqdn] }],
                            Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
                        })
                    );
                } else {
                    const { Rules } = await elbClient.send(
                        new DescribeRulesCommand({ ListenerArn: listenerArn })
                    );
                    const outdatedRule = Rules.find(
                        (r) =>
                            !r.IsDefault &&
                            r.Conditions.some(
                                (c) => c.Field === "host-header" && c.Values.includes(fqdn)
                            )
                    );
                    if (outdatedRule) {
                        await elbClient.send(
                            new DeleteRuleCommand({ RuleArn: outdatedRule.RuleArn })
                        );
                    }
                    const priority = await pickPriority();
                    await elbClient.send(
                        new CreateRuleCommand({
                            ListenerArn: listenerArn,
                            Priority: priority,
                            Conditions: [{ Field: "host-header", Values: [fqdn] }],
                            Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
                        })
                    );
                }
            }
        }

        return { certificateArn };
    }


    async rollbackDeployment({
        organizationID, userID,
        projectID, deploymentID,
        domainName
    }) {
        const ts = new Date().toUTCString();
        const depQ = await pool.query(`
            SELECT d.*, p.name AS project_name, p.current_deployment, p.previous_deployment
            FROM deployments d
            JOIN projects p ON p.project_id = d.project_id
            WHERE d.deployment_id = $1
                AND d.project_id = $2
                AND d.orgid = $3
                AND d.username = $4
        `,
            [deploymentID, projectID, organizationID, userID]);
        if (!depQ.rowCount) throw new Error("Deployment not found or access denied.");
        const deployment = depQ.rows[0];
        const projectName = deployment.project_name.toLowerCase();

        if (!domainName) throw new Error("domainName must be supplied.");
        const dn = domainName.toLowerCase();
        const isBase = dn === projectName;
        if (!(isBase || dn.endsWith(`.${projectName}`)))
            throw new Error(`Domain “${domainName}” does not belong to project “${projectName}.`);

        const domQ = await pool.query(`
            SELECT domain_id, deployment_id AS current_deployment
            FROM domains
            WHERE project_id = $1 AND domain_name = $2
        `,
            [projectID, dn]);
        if (!domQ.rowCount)
            throw new Error(`Domain “${domainName}” is unknown for this project.`);
        const { domain_id: domainID, current_deployment: oldActiveID } = domQ.rows[0];

        if (oldActiveID === deploymentID)
            throw new Error(`Deployment ${deploymentID} is already active for ${dn}.`);

        const taskDefArn = deployment.task_def_arn ||
            await this.getTaskDefinitionARN(projectName, deploymentID);
        const targetGroupArn = await this.ensureTargetGroup(
            projectName, isBase ? null : dn);

        await this.createOrUpdateService({
            projectName,
            subdomain: isBase ? null : dn,
            taskDefArn,
            targetGroupArn
        });
        await this.updateDNSRecord(projectName, [dn]);

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            if (oldActiveID) {
                const r1 = await client.query(
                    `
                        UPDATE deployments
                        SET status='inactive', updated_at=$1
                        WHERE deployment_id=$2 RETURNING deployment_id
                    `,
                    [ts, oldActiveID]);
            }

            const r2 = await client.query(
                `
                    UPDATE deployments
                    SET status='active',
                        updated_at=$1,
                        last_deployed_at=$1
                    WHERE deployment_id=$2 RETURNING deployment_id
                `,
                [ts, deploymentID]);

            const r3 = await client.query(
                `
                    UPDATE domains
                    SET deployment_id=$1, updated_at=$2
                    WHERE domain_id=$3
                `,
                [deploymentID, ts, domainID]);

            const r4 = await client.query(
                `
                    UPDATE projects
                    SET previous_deployment=$1,
                        current_deployment =$2,
                        updated_at=$3
                    WHERE project_id=$4
                `,
                [oldActiveID, deploymentID, ts, projectID]);

            await client.query(
                `
                    INSERT INTO deployment_logs
                        (orgid,username,project_id,project_name,action,deployment_id,timestamp,ip_address)
                    VALUES ($1,$2,$3,$4,'rollback',$5,$6,'127.0.0.1')
                `,
                [organizationID, userID, projectID, projectName, deploymentID, ts]);

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

        this.recordRuntimeLogs(
            organizationID, userID, deploymentID, projectName, dn
        );

        return {
            message: `Rolled back ${dn} to deployment ${deploymentID}.`,
            url: `https://${isBase ? projectName : dn}.stackforgeengine.com`,
            deploymentID
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
    
        let client;
        const errors = [];
        const warnings = [];
    
        const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), ms));
        const timeoutMs = 60000;
    
        if (!process.env.AWS_REGION) errors.push('AWS_REGION is not set');
        if (!process.env.ROUTE53_HOSTED_ZONE_ID) errors.push('ROUTE53_HOSTED_ZONE_ID is not set');
        if (errors.length > 0) {
            throw new Error(`Environment variable validation failed: ${errors.join('; ')}`);
        }
    
        try {
            client = await pool.connect();
            await client.query("BEGIN");
    
            const projectResult = await client.query(
                "SELECT * FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                [projectID, organizationID, userID]
            );
            if (projectResult.rows.length === 0) {
                throw new Error("Project not found or access denied.");
            }
    
            const domainResult = await client.query(
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
    
            let targetGroupArns = domains
                .map(d => d.targetGroupArn)
                .filter(arn => arn && arn.match(/:targetgroup\/[a-zA-Z0-9-]+\/[a-f0-9]+$/));
            try {
                const tgResp = await Promise.race([
                    elbv2Client.send(new DescribeTargetGroupsCommand({})),
                    timeout(timeoutMs)
                ]);
                targetGroupArns.push(...tgResp.TargetGroups
                    .filter(tg => tg.TargetGroupName.toLowerCase().includes(projectName.toLowerCase()))
                    .map(tg => tg.TargetGroupArn)
                );
                targetGroupArns = [...new Set(targetGroupArns)];
            } catch (error) {
                warnings.push(`Failed to list target groups: ${error.message}`);
            }
    
            const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
            if (listenerArn) {
                try {
                    const rulesResp = await Promise.race([
                        elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listenerArn })),
                        timeout(timeoutMs)
                    ]);
                    const rulesToDelete = rulesResp.Rules.filter(rule =>
                        !rule.IsDefault && rule.Actions.some(action =>
                            targetGroupArns.includes(action.TargetGroupArn)
                        )
                    );
                    for (const rule of rulesToDelete) {
                        try {
                            await Promise.race([
                                elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })),
                                timeout(timeoutMs)
                            ]);
                        } catch (error) {
                            warnings.push(`Failed to delete ELB rule ${rule.RuleArn}: ${error.message}`);
                        }
                    }
                } catch (error) {
                    warnings.push(`Failed to process ELB rules: ${error.message}`);
                }
            }
    
            try {
                const servicesResp = await Promise.race([
                    ecsClient.send(new ListServicesCommand({ cluster: "stackforge-cluster" })),
                    timeout(timeoutMs)
                ]);
                const servicesToDelete = servicesResp.serviceArns.filter(arn =>
                    arn.toLowerCase().includes(projectName.toLowerCase())
                );
                for (const serviceArn of servicesToDelete) {
                    const serviceName = serviceArn.split('/').pop();
                    try {
                        await Promise.race([
                            ecsClient.send(new UpdateServiceCommand({
                                cluster: "stackforge-cluster",
                                service: serviceName,
                                desiredCount: 0
                            })),
                            timeout(timeoutMs)
                        ]);
    
                        let tasksRunning = true;
                        let retries = 3;
                        while (tasksRunning && retries > 0) {
                            const tasksResp = await Promise.race([
                                ecsClient.send(new ListTasksCommand({
                                    cluster: "stackforge-cluster",
                                    serviceName
                                })),
                                timeout(timeoutMs)
                            ]);
                            if (!tasksResp.taskArns?.length) {
                                tasksRunning = false;
                            } else {
                                for (const taskArn of tasksResp.taskArns) {
                                    try {
                                        await Promise.race([
                                            ecsClient.send(new StopTaskCommand({
                                                cluster: "stackforge-cluster",
                                                task: taskArn,
                                                reason: `Stopping task for project ${projectName} deletion`
                                            })),
                                            timeout(timeoutMs)
                                        ]);
                                    } catch (taskError) {
                                        warnings.push(`Failed to stop ECS task ${taskArn}: ${taskError.message}`);
                                    }
                                }
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                retries--;
                            }
                        }
                        if (tasksRunning) {
                            warnings.push(`Tasks still running for ECS service ${serviceName}`);
                        }
    
                        await Promise.race([
                            ecsClient.send(new DeleteServiceCommand({
                                cluster: "stackforge-cluster",
                                service: serviceName,
                                force: true
                            })),
                            timeout(timeoutMs)
                        ]);
    
                        const taskDefsResp = await Promise.race([
                            ecsClient.send(new ListTaskDefinitionsCommand({ familyPrefix: serviceName })),
                            timeout(timeoutMs)
                        ]);
                        for (const taskDefArn of taskDefsResp.taskDefinitionArns || []) {
                            await Promise.race([
                                ecsClient.send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefArn })),
                                timeout(timeoutMs)
                            ]);
                        }
                    } catch (error) {
                        warnings.push(`Failed to delete ECS service ${serviceName}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to process ECS services: ${error.message}`);
            }
    
            try {
                const reposResp = await Promise.race([
                    ecrClient.send(new DescribeRepositoriesCommand({})),
                    timeout(timeoutMs)
                ]);
                const reposToDelete = reposResp.repositories.filter(repo =>
                    repo.repositoryName.toLowerCase().includes(projectName.toLowerCase())
                );
                for (const repo of reposToDelete) {
                    try {
                        await Promise.race([
                            ecrClient.send(new DeleteRepositoryCommand({
                                repositoryName: repo.repositoryName,
                                force: true
                            })),
                            timeout(timeoutMs)
                        ]);
                    } catch (error) {
                        warnings.push(`Failed to delete ECR repository ${repo.repositoryName}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list ECR repositories: ${error.message}`);
            }
    
            const changes = [];
            for (const domain of domainsToClean) {
                const recordName = domain.endsWith(".") ? domain : `${domain}.`;
                try {
                    const listResp = await Promise.race([
                        route53Client.send(new ListResourceRecordSetsCommand({
                            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                            StartRecordName: recordName,
                            MaxItems: "10"
                        })),
                        timeout(timeoutMs)
                    ]);
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
                } catch (error) {
                    warnings.push(`Failed to list Route53 records for ${recordName}: ${error.message}`);
                }
            }
            if (changes.length > 0) {
                try {
                    await Promise.race([
                        route53Client.send(new ChangeResourceRecordSetsCommand({
                            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                            ChangeBatch: { Changes: changes }
                        })),
                        timeout(timeoutMs)
                    ]);
                } catch (error) {
                    warnings.push(`Failed to delete Route53 records: ${error.message}`);
                }
            }
    
            for (const tgArn of targetGroupArns) {
                try {
                    const maxRetries = 3;
                    let retryCount = 0;
                    while (retryCount < maxRetries) {
                        try {
                            await Promise.race([
                                elbv2Client.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn })),
                                timeout(timeoutMs)
                            ]);
                            break;
                        } catch (error) {
                            if (error.name === "ResourceInUseException" && retryCount < maxRetries - 1) {
                                const listenersResp = await Promise.race([
                                    elbv2Client.send(new DescribeListenersCommand({})),
                                    timeout(timeoutMs)
                                ]);
                                for (const listener of listenersResp.Listeners || []) {
                                    const rulesResp = await Promise.race([
                                        elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listener.ListenerArn })),
                                        timeout(timeoutMs)
                                    ]);
                                    const rulesUsingTg = rulesResp.Rules.filter(rule =>
                                        rule.Actions.some(action => action.TargetGroupArn === tgArn)
                                    );
                                    for (const rule of rulesUsingTg) {
                                        try {
                                            await Promise.race([
                                                elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })),
                                                timeout(timeoutMs)
                                            ]);
                                        } catch (ruleError) {
                                            warnings.push(`Failed to delete rule ${rule.RuleArn} for target group ${tgArn}: ${ruleError.message}`);
                                        }
                                    }
                                }
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                retryCount++;
                            } else {
                                warnings.push(`Failed to delete target group ${tgArn}: ${error.message}`);
                                break;
                            }
                        }
                    }
                } catch (error) {
                    warnings.push(`Failed to process target group ${tgArn}: ${error.message}`);
                }
            }
    
            const certificateArns = [...new Set(domains
                .map(d => d.certificateArn)
                .filter(arn => arn))];
            try {
                const certList = await Promise.race([
                    acmClient.send(new ListCertificatesCommand({
                        CertificateStatuses: ["ISSUED", "PENDING_VALIDATION"]
                    })),
                    timeout(timeoutMs)
                ]);
                for (const cert of certList.CertificateSummaryList || []) {
                    const domainLower = cert.DomainName.toLowerCase();
                    if (domainLower.includes(projectName.toLowerCase()) ||
                        domainLower === `${projectName.toLowerCase()}.stackforgeengine.com` ||
                        domainLower === `*.${projectName.toLowerCase()}.stackforgeengine.com`) {
                        certificateArns.push(cert.CertificateArn);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list ACM certificates: ${error.message}`);
            }
    
            for (const certArn of certificateArns) {
                try {
                    const maxDetachRetries = 2;
                    let detachRetryCount = 0;
                    let isDetached = false;
                    while (detachRetryCount < maxDetachRetries && !isDetached) {
                        const lbsResp = await Promise.race([
                            elbv2Client.send(new DescribeLoadBalancersCommand({})),
                            timeout(timeoutMs)
                        ]);
                        let foundCert = false;
                        for (const lb of lbsResp.LoadBalancers || []) {
                            const listenersResp = await Promise.race([
                                elbv2Client.send(new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn })),
                                timeout(timeoutMs)
                            ]);
                            for (const listener of listenersResp.Listeners || []) {
                                const certsResp = await Promise.race([
                                    elbv2Client.send(new DescribeListenerCertificatesCommand({ ListenerArn: listener.ListenerArn })),
                                    timeout(timeoutMs)
                                ]);
                                if (certsResp.Certificates?.some(c => c.CertificateArn === certArn)) {
                                    foundCert = true;
                                    try {
                                        await Promise.race([
                                            elbv2Client.send(new RemoveListenerCertificatesCommand({
                                                ListenerArn: listener.ListenerArn,
                                                Certificates: [{ CertificateArn: certArn }]
                                            })),
                                            timeout(timeoutMs)
                                        ]);
                                    } catch (error) {
                                        warnings.push(`Failed to remove certificate ${certArn} from listener: ${error.message}`);
                                    }
                                }
                            }
                        }
                        isDetached = !foundCert;
                        if (!isDetached) {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            detachRetryCount++;
                        }
                    }
    
                    const distributions = await Promise.race([
                        cloudFrontClient.send(new ListDistributionsCommand({})),
                        timeout(timeoutMs)
                    ]);
                    let distributionAttached = false;
                    for (const dist of distributions.DistributionList?.Items || []) {
                        if (dist.ViewerCertificate?.ACMCertificateArn === certArn) {
                            distributionAttached = true;
                            try {
                                const distConfig = await Promise.race([
                                    cloudFrontClient.send(new GetDistributionConfigCommand({ Id: dist.Id })),
                                    timeout(timeoutMs)
                                ]);
                                await Promise.race([
                                    cloudFrontClient.send(new UpdateDistributionCommand({
                                        Id: dist.Id,
                                        IfMatch: distConfig.ETag,
                                        DistributionConfig: {
                                            ...distConfig.DistributionConfig,
                                            ViewerCertificate: {
                                                CloudFrontDefaultCertificate: true,
                                                MinimumProtocolVersion: "TLSv1"
                                            }
                                        }
                                    })),
                                    timeout(timeoutMs)
                                ]);
                                await new Promise(resolve => setTimeout(resolve, 5000));
                            } catch (error) {
                                warnings.push(`Failed to update CloudFront distribution ${dist.Id}: ${error.message}`);
                            }
                        }
                    }
    
                    if (!distributionAttached && isDetached) {
                        const maxRetries = 2;
                        let retryCount = 0;
                        while (retryCount < maxRetries) {
                            try {
                                const certInfo = await Promise.race([
                                    acmClient.send(new DescribeCertificateCommand({ CertificateArn: certArn })),
                                    timeout(timeoutMs)
                                ]);
                                if (certInfo.Certificate.InUseBy?.length > 0) {
                                    warnings.push(`Certificate ${certArn} still in use by: ${certInfo.Certificate.InUseBy.join(', ')}`);
                                    break;
                                }
                                await Promise.race([
                                    acmClient.send(new DeleteCertificateCommand({ CertificateArn: certArn })),
                                    timeout(timeoutMs)
                                ]);
                                break;
                            } catch (error) {
                                if (error.name === "ResourceInUseException" && retryCount < maxRetries - 1) {
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                    retryCount++;
                                } else {
                                    warnings.push(`Failed to delete ACM certificate ${certArn}: ${error.message}`);
                                    break;
                                }
                            }
                        }
                    } else {
                        warnings.push(`Certificate ${certArn} not deleted due to attachments`);
                    }
                } catch (error) {
                    warnings.push(`Failed to process ACM certificate ${certArn}: ${error.message}`);
                }
            }
    
            try {
                const projectsResp = await Promise.race([
                    codeBuildClient.send(new ListProjectsCommand({})),
                    timeout(timeoutMs)
                ]);
                const projectsToDelete = projectsResp.projects.filter(p =>
                    p.toLowerCase().includes(projectName.toLowerCase())
                );
                for (const project of projectsToDelete) {
                    try {
                        await Promise.race([
                            codeBuildClient.send(new DeleteProjectCommand({ name: project })),
                            timeout(timeoutMs)
                        ]);
                    } catch (error) {
                        warnings.push(`Failed to delete CodeBuild project ${project}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list CodeBuild projects: ${error.message}`);
            }
    
            try {
                const logGroupsResp = await Promise.race([
                    cloudWatchLogsClient.send(new DescribeLogGroupsCommand({})),
                    timeout(timeoutMs)
                ]);
                const logGroupsToDelete = logGroupsResp.logGroups.filter(group =>
                    group.logGroupName.toLowerCase().includes(projectName.toLowerCase())
                );
                for (const logGroup of logGroupsToDelete) {
                    try {
                        await Promise.race([
                            cloudWatchLogsClient.send(new DeleteLogGroupCommand({ logGroupName: logGroup.logGroupName })),
                            timeout(timeoutMs)
                        ]);
                    } catch (error) {
                        warnings.push(`Failed to delete CloudWatch log group ${logGroup.logGroupName}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list CloudWatch log groups: ${error.message}`);
            }
    
            for (const domain of domains.map(d => d.name)) {
                await client.query("DELETE FROM metrics_events WHERE domain = $1", [domain]);
                await client.query("DELETE FROM metrics_daily WHERE domain = $1", [domain]);
                await client.query("DELETE FROM metrics_edge_requests WHERE domain = $1", [domain]);
            }
            await client.query("DELETE FROM deployment_logs WHERE project_id = $1 AND orgid = $2", [projectID, organizationID]);
            await client.query(
                "DELETE FROM build_logs WHERE orgid = $1 AND deployment_id IN (SELECT deployment_id FROM deployments WHERE project_id = $2)",
                [organizationID, projectID]
            );
            await client.query(
                "DELETE FROM runtime_logs WHERE orgid = $1 AND deployment_id IN (SELECT deployment_id FROM deployments WHERE project_id = $2)",
                [organizationID, projectID]
            );
            await client.query("DELETE FROM deployments WHERE project_id = $1 AND orgid = $2", [projectID, organizationID]);
            await client.query("DELETE FROM domains WHERE project_id = $1 AND orgid = $2", [projectID, organizationID]);
            await client.query(
                "DELETE FROM projects WHERE project_id = $1 AND orgid = $2 AND username = $3",
                [projectID, organizationID, userID]
            );
    
            await client.query(
                `INSERT INTO deployment_logs (orgid, username, project_id, project_name, action, timestamp, ip_address) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [organizationID, userID, projectID, projectName, "delete", timestamp, "127.0.0.1"]
            );
    
            await client.query("COMMIT");
            return {
                message: `Project ${projectName} deleted successfully.`,
                warnings: warnings.length > 0 ? warnings.join('; ') : undefined
            };
        } catch (error) {
            if (client) {
                await client.query("ROLLBACK");
            }
            throw new Error(`Failed to delete project: ${error.message}${warnings.length > 0 ? `; Warnings: ${warnings.join('; ')}` : ''}`);
        } finally {
            if (client) {
                client.release();
            }
        }
    }
    
    async cleanupFailedDeployment({ organizationID, userID, projectID, projectName, domainName, deploymentID, domainID, certificateArn, targetGroupArn }) {
        const timestamp = new Date().toISOString();
        const acmClient = new ACMClient({ region: process.env.AWS_REGION });
        const route53Client = new Route53Client({ region: process.env.AWS_REGION });
        const elbv2Client = new ElasticLoadBalancingV2Client({ region: process.env.AWS_REGION });
        const codeBuildClient = new CodeBuildClient({ region: process.env.AWS_REGION });
        const cloudWatchLogsClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
        const ecrClient = new ECRClient({ region: process.env.AWS_REGION });
        const ecsClient = new ECSClient({ region: process.env.AWS_REGION });
        const cloudFrontClient = new CloudFrontClient({ region: process.env.AWS_REGION });
    
        let client;
        const errors = [];
        const warnings = [];
    
        const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), ms));
        const timeoutMs = 60000;
    
        if (!process.env.AWS_REGION) errors.push('AWS_REGION is not set');
        if (!process.env.ROUTE53_HOSTED_ZONE_ID) errors.push('ROUTE53_HOSTED_ZONE_ID is not set');
        if (errors.length > 0) {
            throw new Error(`Environment variable validation failed: ${errors.join('; ')}`);
        }
    
        try {
            client = await pool.connect();
            await client.query("BEGIN");
    
            let targetGroupArns = [targetGroupArn].filter(arn => arn && arn.match(/:targetgroup\/[a-zA-Z0-9-]+\/[a-f0-9]+$/));
            try {
                const tgResp = await Promise.race([
                    elbv2Client.send(new DescribeTargetGroupsCommand({})),
                    timeout(timeoutMs)
                ]);
                targetGroupArns.push(...tgResp.TargetGroups
                    .filter(tg => tg.TargetGroupName.toLowerCase().includes(projectName.toLowerCase()))
                    .map(tg => tg.TargetGroupArn)
                );
                targetGroupArns = [...new Set(targetGroupArns)];
            } catch (error) {
                warnings.push(`Failed to list target groups: ${error.message}`);
            }
    
            const listenerArn = process.env.ALB_LISTENER_ARN_HTTPS;
            if (listenerArn) {
                try {
                    const rulesResp = await Promise.race([
                        elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listenerArn })),
                        timeout(timeoutMs)
                    ]);
                    const rulesToDelete = rulesResp.Rules.filter(rule =>
                        !rule.IsDefault && rule.Actions.some(action =>
                            targetGroupArns.includes(action.TargetGroupArn)
                        )
                    );
                    for (const rule of rulesToDelete) {
                        try {
                            await Promise.race([
                                elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })),
                                timeout(timeoutMs)
                            ]);
                        } catch (error) {
                            warnings.push(`Failed to delete ELB rule ${rule.RuleArn}: ${error.message}`);
                        }
                    }
                } catch (error) {
                    warnings.push(`Failed to process ELB rules: ${error.message}`);
                }
            }
    
            try {
                const servicesResp = await Promise.race([
                    ecsClient.send(new ListServicesCommand({ cluster: "stackforge-cluster" })),
                    timeout(timeoutMs)
                ]);
                const servicesToDelete = servicesResp.serviceArns.filter(arn =>
                    arn.toLowerCase().includes(projectName.toLowerCase())
                );
                for (const serviceArn of servicesToDelete) {
                    const serviceName = serviceArn.split('/').pop();
                    try {
                        await Promise.race([
                            ecsClient.send(new UpdateServiceCommand({
                                cluster: "stackforge-cluster",
                                service: serviceName,
                                desiredCount: 0
                            })),
                            timeout(timeoutMs)
                        ]);
    
                        let tasksRunning = true;
                        let retries = 3;
                        while (tasksRunning && retries > 0) {
                            const tasksResp = await Promise.race([
                                ecsClient.send(new ListTasksCommand({
                                    cluster: "stackforge-cluster",
                                    serviceName
                                })),
                                timeout(timeoutMs)
                            ]);
                            if (!tasksResp.taskArns?.length) {
                                tasksRunning = false;
                            } else {
                                for (const taskArn of tasksResp.taskArns) {
                                    try {
                                        await Promise.race([
                                            ecsClient.send(new StopTaskCommand({
                                                cluster: "stackforge-cluster",
                                                task: taskArn,
                                                reason: `Stopping task for failed deployment ${deploymentID}`
                                            })),
                                            timeout(timeoutMs)
                                        ]);
                                    } catch (taskError) {
                                        warnings.push(`Failed to stop ECS task ${taskArn}: ${taskError.message}`);
                                    }
                                }
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                retries--;
                            }
                        }
                        if (tasksRunning) {
                            warnings.push(`Tasks still running for ECS service ${serviceName}`);
                        }
    
                        await Promise.race([
                            ecsClient.send(new DeleteServiceCommand({
                                cluster: "stackforge-cluster",
                                service: serviceName,
                                force: true
                            })),
                            timeout(timeoutMs)
                        ]);
    
                        const taskDefsResp = await Promise.race([
                            ecsClient.send(new ListTaskDefinitionsCommand({ familyPrefix: serviceName })),
                            timeout(timeoutMs)
                        ]);
                        for (const taskDefArn of taskDefsResp.taskDefinitionArns || []) {
                            await Promise.race([
                                ecsClient.send(new DeregisterTaskDefinitionCommand({ taskDefinition: taskDefArn })),
                                timeout(timeoutMs)
                            ]);
                        }
                    } catch (error) {
                        warnings.push(`Failed to delete ECS service ${serviceName}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to process ECS services: ${error.message}`);
            }
    
            const domainFqdn = domainName.includes('.') ? domainName : `${domainName}.stackforgeengine.com`;
            const recordName = domainFqdn.endsWith(".") ? domainFqdn : `${domainFqdn}.`;
            try {
                const listResp = await Promise.race([
                    route53Client.send(new ListResourceRecordSetsCommand({
                        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                        StartRecordName: recordName,
                        MaxItems: "10"
                    })),
                    timeout(timeoutMs)
                ]);
                const records = listResp.ResourceRecordSets.filter(r =>
                    r.Name === recordName &&
                    ["A", "CNAME", "MX", "AAAA"].includes(r.Type)
                );
                if (records.length > 0) {
                    await Promise.race([
                        route53Client.send(new ChangeResourceRecordSetsCommand({
                            HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
                            ChangeBatch: {
                                Changes: records.map(record => ({
                                    Action: "DELETE",
                                    ResourceRecordSet: record
                                }))
                            }
                        })),
                        timeout(timeoutMs)
                    ]);
                }
            } catch (error) {
                warnings.push(`Failed to process Route53 records for ${recordName}: ${error.message}`);
            }
    
            for (const tgArn of targetGroupArns) {
                try {
                    const maxRetries = 3;
                    let retryCount = 0;
                    while (retryCount < maxRetries) {
                        try {
                            await Promise.race([
                                elbv2Client.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn })),
                                timeout(timeoutMs)
                            ]);
                            break;
                        } catch (error) {
                            if (error.name === "ResourceInUseException" && retryCount < maxRetries - 1) {
                                const listenersResp = await Promise.race([
                                    elbv2Client.send(new DescribeListenersCommand({})),
                                    timeout(timeoutMs)
                                ]);
                                for (const listener of listenersResp.Listeners || []) {
                                    const rulesResp = await Promise.race([
                                        elbv2Client.send(new DescribeRulesCommand({ ListenerArn: listener.ListenerArn })),
                                        timeout(timeoutMs)
                                    ]);
                                    const rulesUsingTg = rulesResp.Rules.filter(rule =>
                                        rule.Actions.some(action => action.TargetGroupArn === tgArn)
                                    );
                                    for (const rule of rulesUsingTg) {
                                        try {
                                            await Promise.race([
                                                elbv2Client.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn })),
                                                timeout(timeoutMs)
                                            ]);
                                        } catch (ruleError) {
                                            warnings.push(`Failed to delete rule ${rule.RuleArn} for target group ${tgArn}: ${ruleError.message}`);
                                        }
                                    }
                                }
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                retryCount++;
                            } else {
                                warnings.push(`Failed to delete target group ${tgArn}: ${error.message}`);
                                break;
                            }
                        }
                    }
                } catch (error) {
                    warnings.push(`Failed to process target group ${tgArn}: ${error.message}`);
                }
            }
    
            const certificateArns = [certificateArn].filter(arn => arn);
            try {
                const certList = await Promise.race([
                    acmClient.send(new ListCertificatesCommand({
                        CertificateStatuses: ["ISSUED", "PENDING_VALIDATION"]
                    })),
                    timeout(timeoutMs)
                ]);
                for (const cert of certList.CertificateSummaryList || []) {
                    const domainLower = cert.DomainName.toLowerCase();
                    if (domainLower.includes(projectName.toLowerCase()) ||
                        domainLower === `${projectName.toLowerCase()}.stackforgeengine.com` ||
                        domainLower === `*.${projectName.toLowerCase()}.stackforgeengine.com`) {
                        certificateArns.push(cert.CertificateArn);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list ACM certificates: ${error.message}`);
            }
    
            for (const certArn of certificateArns) {
                try {
                    const maxDetachRetries = 2;
                    let detachRetry = 0;
                    let isDetached = true;
                    while (detachRetry < maxDetachRetries && !isDetached) {
                        const lbsResp = await Promise.race([
                            elbv2Client.send(new DescribeLoadBalancers({})),
                            [],
                            timeout(timeoutMs)
                        ]);
                        let foundCert = false;
                        for (const lb of lbsResp.LoadBalancers || []) {
                            const listenersResp = await Promise.race([
                                elbv2Client.send(new DescribeListeners({ LoadBalancerArn: lb.LoadBalancerArn })),
                                [],
                                timeout(timeoutMs)
                            ]);
                            for (const listener of listenersResp.Listeners || []) {
                                const certsResp = await Promise.race([
                                    elbv2Client.send(new DescribeListenerCertificates({ ListenerArn: listener.ListenerArn })),
                                    { Certificates: [] },
                                    timeout(timeoutMs)
                                ]);
                                if (certsResp.Certificates?.some(c => c.CertificateArn === certArn)) {
                                    foundCert = true;
                                    try {
                                        await Promise.race([
                                            elbv2Client.send(new RemoveListenerCertificatesCommand({
                                                ListenerArn: listener.ListenerArn,
                                                Certificates: [{ CertificateArn: certArn }]
                                            })),
                                            timeout(timeoutMs)
                                        ]);
                                    } catch (error) {
                                        warnings.push(`Failed to remove certificate ${certArn} from listener: ${error.message}`);
                                    }
                                }
                            }
                        }
                        isDetached = !foundCert;
                        if (!isDetached) {
                            await new Promise(resolve => setTimeout(resolve, 0));
                            detachRetry++;
                        }
                    }
    
                    const distributions = await Promise.race([
                        cloudFrontClient.send(new ListDistributions({})),
                        { DistributionList: {} },
                        timeout(timeoutMs)
                    ]);
                    let distributionAttached = false;
                    for (const dist of distributions.DistributionList?.Items || []) {
                        if (dist.ViewerCertificate?.ACMCertificateArn === certArn) {
                            distributionAttached = true;
                            try {
                                const distConfig = await new Promise.race([
                                    cloudFrontClient.send(new GetDistributionConfig({ Id: dist.Id })),
                                    {},
                                    timeout(timeoutMs)
                                ]);
                                await Promise.race([
                                    cloudFrontClient.send(new UpdateDistribution({
                                        Id: dist.Id,
                                        IfMatch: distConfig.ETag,
                                        DistributionConfig: {
                                            ...distConfig.DistributionConfig,
                                            ViewerCertificate: {
                                                CloudFrontDefaultCertificate: true,
                                            }
                                        }
                                    })),
                                    timeout(timeoutMs)
                                ]);
                                await new Promise(resolve => setTimeout(resolve, 0));
                            } catch (error) {
                                warnings.push(`Failed to update CloudFront distribution ${dist.Id}: ${error.message}`);
                            }
                        }
                    }
    
                    if (!distributionAttached && isDetached) {
                        const maxRetries = 2;
                        let attempt = 0;
                        while (attempt < maxRetries) {
                            try {
                                const certInfo = await Promise.race([
                                    acmClient.send(new DescribeCertificateCommand({ CertificateArn: certArn })),
                                    { Certificate: {} },
                                    timeout(timeoutMs)
                                ]);
                                if (certInfo.Certificate.InUseBy?.length > 0) {
                                    warnings.push(`Certificate ${certArn} still in use by: ${certInfo.Certificate.InUseBy.join(', ')}`);
                                    break;
                                }
                                await Promise.race([
                                    acmClient.send(new DeleteCertificateCommand({ CertificateArn: certArn })),
                                    timeout(timeoutMs)
                                ]);
                                break;
                            } catch (error) {
                                if (error.name === "ResourceInUseException" && attempt < maxRetries - 1) {
                                    await new Promise(resolve => setTimeout(resolve, 0));
                                    attempt++;
                                } else {
                                    warnings.push(`Failed to delete ACM certificate ${certArn}: ${error.message}`);
                                    break;
                                }
                            }
                        }
                    } else {
                        warnings.push(`Certificate ${certArn} not deleted due to attachments`);
                    }
                } catch (error) {
                    warnings.push(`Failed to process certificate ${certArn}: ${error.message}`);
                }
            }
    
            try {
                const projectsResp = await Promise.race([
                    codeBuildClient.send(new ListProjects()),
                    [],
                    timeout(timeoutMs)
                ]);
                const projectsToDelete = projectsResp.projects.filter(p => p.toLowerCase().includes(projectName.toLowerCase()));
                for (const p of projectsToDelete) {
                    try {
                        await Promise.race([
                            codeBuildClient.send(new DeleteProject({ name: p })),
                            timeout(timeoutMs)
                        ]);
                    } catch (error) {
                        warnings.push(`Failed to delete CodeBuild ${p}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list CodeBuild: ${error.message}`);
            }
    
            try {
                const logGroupsResp = await Promise.race([
                    cloudWatchLogsClient.send(new DescribeLogGroups()),
                    [],
                    timeout(timeoutMs)
                ]);
                const logGroupsToDelete = logGroupsResp.logGroups.filter(g => g.logGroupName.toLowerCase().includes(projectName.toLowerCase()));
                for (const g of logGroupsToDelete) {
                    try {
                        await Promise.race([
                            cloudWatchLogsClient.send(new DeleteLogGroup({ logGroupName: g.logGroupName })),
                            timeout(timeoutMs)
                        ]);
                    } catch (error) {
                        warnings.push(`Failed to delete log group ${g.logGroupName}: ${error.message}`);
                    }
                }
            } catch (error) {
                warnings.push(`Failed to list log groups: ${error.message}`);
            }
    
            await client.query("DELETE FROM metrics_events WHERE domain = $1", [domainName]);
            await client.query("DELETE FROM metrics_daily WHERE domain = $1", [domainName]);
            await client.query("DELETE FROM metrics_edge_requests WHERE domain = $1", [domainName]);
            await client.query("DELETE FROM deployment_logs WHERE deployment_id = $1 AND orgid = $2", [deploymentID, organizationID]);
            await client.query("DELETE FROM build_logs WHERE deployment_id = $1 AND orgid = $2", [deploymentID, organizationID]);
            await client.query("DELETE FROM runtime_logs WHERE deployment_id = $1 AND orgid = $2", [deploymentID, organizationID]);
            await client.query("DELETE FROM deployments WHERE deployment_id = $1 AND orgid = $2", [deploymentID, organizationID]);
            if (domainID) {
                await client.query("DELETE FROM domains WHERE id = $1 AND orgid = $2", [domainID, organizationID]);
            }
    
            await client.query(
                `INSERT INTO deployment_logs (orgid, username, deployment_id, project_id, project_name, action, timestamp, ip_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [organizationID, userID, deploymentID, projectID, projectName, "cleanup_failed", timestamp, "127.0.0.1"]
            );
    
            await client.query("COMMIT");
            return {
                message: `Cleanup of deployment ${deploymentID} completed successfully.`,
                warnings: warnings.length > 0 ? warnings.join(", ") : undefined
            };
        } catch (error) {
            if (client) {
                await client.query("ROLLBACK");
            }
            throw new Error(`Cleanup failed: ${error.message}${warnings.length > 0 ? `; Warnings: ${warnings.join(', ')}` : ''}`);
        } finally {
            if (client) {
                client.release();
            }
        }
    }
}

module.exports = new DeployManager();