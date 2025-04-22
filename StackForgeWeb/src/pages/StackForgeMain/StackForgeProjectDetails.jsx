import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSearch,
    faThLarge,
    faList,
    faCaretDown,
    faCheck,
    faInfo,
    faKeyboard,
    faInfoCircle,
    faCircleInfo,
    faGrip,
    faSquare,
    faSquareArrowUpRight,
    faArrowUpRightFromSquare,
    faEllipsisV,
    faEllipsisH,
    faCodeBranch,
    faArrowRightArrowLeft,
    faArrowRotateLeft,
    faHammer,
    faGaugeHigh,
    faCircleCheck,
    faCodeCommit,
    faCaretRight,
    faStar,
    faCodePullRequest,
    faUsers,
    faFileCode,
    faTriangleExclamation,
    faXmark
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjectDetails.css";
import "../../styles/helperStyles/Unavailable.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProjectDetails = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [searchTerm, setSearchTerm] = useState('');
    const [projectDetails, setProjectDetails] = useState(null);
    const [snapshotUrl, setSnapshotUrl] = useState(null);
    const [commits, setCommits] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [isRollbackModalOpen, setRollbackModalOpen] = useState(false);
    const [selectedDeployment, setSelectedDeployment] = useState(null);
    const [isRollbackLoading, setIsRollbackLoading] = useState(false);
    const projectID = location.state?.projectID;
    const repository = location.state?.repository;

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            await fetchProjectInfo();
            setIsLoaded(true);
        };
        if (!loading && token) fetchData();
    }, [userID, loading, token]);

    useEffect(() => {
        const handleResize = () => {
            setIsLoaded(false);
            setScreenSize(window.innerWidth);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (projectDetails && projectDetails.project) {
            fetchSnapshot();
            fetchCommits();
            fetchAnalytics();
        }
    }, [projectDetails]);

    useEffect(() => {
        const handleRejection = (event) => { };
        window.addEventListener('unhandledrejection', handleRejection);
        return () => window.removeEventListener('unhandledrejection', handleRejection);
    }, []);

    const fetchProjectInfo = async () => {
        try {
            const response = await fetch("http://localhost:3000/project-details", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    organizationID: organizationID,
                    userID: userID,
                    projectID: projectID
                })
            });
            if (!response.ok) {
                throw new Error("Failed to fetch project details");
            }
            const data = await response.json();
            setProjectDetails(data);
        } catch (error) { }
    };

    const fetchSnapshot = async () => {
        try {
            const response = await fetch("http://localhost:3000/snapshot", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    organizationID: organizationID,
                    userID: userID,
                    projectID: projectID
                })
            });
            if (!response.ok) {
                throw new Error("Failed to fetch snapshot");
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setSnapshotUrl(url);
        } catch (error) { }
    };

    const fetchCommits = async () => {
        try {
            const response = await fetch("http://localhost:3000/git-commits", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    userID: userID,
                    owner: projectDetails.project.created_by,
                    repo: projectDetails.project.repository
                })
            });
            if (!response.ok) {
                throw new Error("Failed to fetch commits");
            }
            const data = await response.json();
            setCommits(data);
        } catch (error) { }
    };

    const fetchAnalytics = async () => {
        try {
            const response = await fetch("http://localhost:3000/git-analytics", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    userID: userID,
                    websiteURL: projectDetails.project.url,
                    repository: projectDetails.project.repository,
                    owner: projectDetails.project.created_by,
                    projectName: projectDetails.project.name
                })
            });
            if (!response.ok) {
                throw new Error("Failed to fetch analytics");
            }
            const data = await response.json();
            setAnalytics(data);
        } catch (error) { }
    };

    const openRollbackModal = () => {
        const previous = projectDetails.project.previous_deployment;
        setSelectedDeployment(previous);
        setRollbackModalOpen(true);
    };

    const closeRollbackModal = () => {
        setRollbackModalOpen(false);
        setSelectedDeployment(null);
        setIsRollbackLoading(false);
    };

    const confirmRollback = async () => {
        setIsRollbackLoading(true);
        try {
            const response = await fetch("http://localhost:3000/rollback-deployment", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    organizationID: organizationID,
                    userID: userID,
                    projectID: projectID,
                    deploymentID: selectedDeployment
                })
            });

            setIsRollbackLoading(false);
            closeRollbackModal();

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `Rollback failed with status ${response.status}`);
            }

            const data = await response.json();
            showDialog({
                title: "Success",
                message: data.message || "Rollback completed successfully",
                showCancel: false
            });
        } catch (error) {
            showDialog({
                title: "Error",
                message: error.message || "An unexpected error occurred during rollback",
                showCancel: false
            });
        }
        await fetchProjectInfo();
        setTimeout(() => {
            if (isRollbackLoading || isRollbackModalOpen) {
                setIsRollbackLoading(false);
                setRollbackModalOpen(false);
            }
        }, 1000);
    };

    const getGithubUrl = () => {
        if (projectDetails && projectDetails.project) {
            const repo = projectDetails.project.repository;
            return repo.includes("/")
                ? `https://github.com/${repo}`
                : `https://github.com/${projectDetails.project.created_by}/${repo}`;
        }
        return "#";
    };

    return (
        <div
            className="projectDetailsPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />

            {isLoaded && projectDetails?.project && (
                <div className="projectDetailsCellHeaderContainer">
                    <div className="projectDetailsTopBar">
                        <h1>
                            {projectDetails.project.name}
                            <br />
                            <p>ID: {projectID}</p>
                        </h1>
                        <span>
                            <button
                                onClick={() =>
                                    window.open(getGithubUrl(), "_blank")
                                }
                            >
                                <FontAwesomeIcon icon={faGithub} />
                                <p>GitHub Repository</p>
                            </button>
                            <button>
                                <p>Usage</p>
                            </button>
                            <button>
                                <p>Domains</p>
                            </button>
                        </span>
                    </div>
                    <div className="projectDetailsContainer">
                        <div className="productionDeploymentCell">
                            <div className="productionDeploymentHeader">
                                <h2>Production Deployment</h2>
                                <div className="deploymentMenuButtons">
                                    <button
                                        onClick={() =>
                                            navigate("/build-logs", {
                                                state: {
                                                    projectID,
                                                    deploymentID: projectDetails.project.current_deployment
                                                }
                                            })
                                        }

                                    >
                                        <FontAwesomeIcon icon={faHammer} />
                                        Build Logs
                                    </button>
                                    <button
                                        onClick={() =>
                                            navigate("/runtime-logs", {
                                                state: {
                                                    projectID,
                                                    deploymentID: projectDetails.project.current_deployment
                                                }
                                            })
                                        }

                                    >
                                        Runtime Logs{" "}
                                        <FontAwesomeIcon
                                            icon={faArrowUpRightFromSquare}
                                        />
                                    </button>
                                    <button onClick={openRollbackModal}>
                                        <FontAwesomeIcon
                                            icon={faArrowRotateLeft}
                                        />
                                        Instant Rollback
                                    </button>
                                </div>
                            </div>
                            <div className="productionDeploymentBody">
                                <div className="productionDeploymentScreenshot">
                                    {snapshotUrl ? (
                                        <a
                                            href={projectDetails.project.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <img
                                                src={snapshotUrl}
                                                alt="Deployment Snapshot"
                                            />
                                        </a>
                                    ) : (
                                        <div className="productionDeploymentPlaceholder">
                                            <div className="loading-wrapper">
                                                <div className="loading-circle" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="productionDeploymentDetails">
                                    <div className="deploymentDetailLine">
                                        <strong>Deployment</strong>
                                        <span>{projectDetails.project.current_deployment}</span>
                                    </div>

                                    <div className="deploymentDetailLine">
                                        <strong>Domains</strong>
                                        <span>
                                            {
                                                projectDetails.domains[0]
                                                    ?.domain_name
                                            }
                                            {projectDetails.domains.length >
                                                1
                                                ? ` +${projectDetails.domains
                                                    .length - 1
                                                }`
                                                : ""}
                                        </span>
                                    </div>
                                    <div className="deploymentDetailLineFlex">
                                        <div className="deploymentDetailLine">
                                            <strong>Status</strong>
                                            <span>
                                                {projectDetails.deployments[0]
                                                    ?.status === "active" ? (
                                                    <>
                                                        <span
                                                            className="statusDot"
                                                            style={{
                                                                backgroundColor:
                                                                    "#21BF68"
                                                            }}
                                                        ></span>
                                                        Ready
                                                    </>
                                                ) : (
                                                    <>
                                                        <span
                                                            className="statusDot"
                                                            style={{
                                                                backgroundColor:
                                                                    "#E54B4B"
                                                            }}
                                                        ></span>
                                                        {projectDetails
                                                            .deployments[0]
                                                            ?.status?.charAt(
                                                                0
                                                            )
                                                            .toUpperCase() +
                                                            projectDetails
                                                                .deployments[0]
                                                                ?.status?.slice(
                                                                    1
                                                                )}
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <div className="deploymentDetailLine">
                                            <strong>Created</strong>
                                            <span>
                                                {new Date(
                                                    projectDetails
                                                        .deployments[0]
                                                        ?.created_at
                                                ).toLocaleDateString()}{" "}
                                                by{" "}
                                                {
                                                    projectDetails.deployments[0]
                                                        ?.username
                                                }
                                            </span>
                                        </div>
                                    </div>
                                    <div className="deploymentDetailLine">
                                        <strong>Source</strong>
                                        <span>
                                            <p>
                                                <FontAwesomeIcon
                                                    icon={faCodeBranch}
                                                />{" "}
                                                {
                                                    projectDetails.project
                                                        .branch
                                                }{" "}
                                                <br />
                                            </p>
                                            <p>
                                                <FontAwesomeIcon
                                                    icon={faCodeCommit}
                                                />{" "}
                                                {projectDetails.project.current_deployment?.substring(
                                                    0,
                                                    6
                                                )}{" "}
                                                <i>update</i>
                                            </p>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="productionDeploymentFooter">
                                <button>Deployment Configuration</button>
                                <div className="deploymentProtectionToggles">
                                    <p>
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            style={{ color: "#21BF68" }}
                                        />
                                        Fluid Compute{" "}
                                    </p>
                                    <p>
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            style={{ color: "#21BF68" }}
                                        />
                                        Deployment Protection{" "}
                                    </p>
                                    <p>
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            style={{ color: "#21BF68" }}
                                        />
                                        Skew Protection{" "}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="productionDeploymentMultiCellFlex">
                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Website Analytics</h2>
                                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </div>

                                <div className="productionAnalyticsList">
                                    {analytics ? (
                                        analytics.websiteAnalytics ? (
                                            <div className="productionAnalyticsListItem">
                                                <div className="productionAnalyticsListStatusWrapper">
                                                    <label className="productionAnalyticsListStatus">
                                                        <span>
                                                            <div
                                                                className="statusDotBig"
                                                                style={{
                                                                    backgroundColor:
                                                                        analytics.websiteAnalytics.status === 200
                                                                            ? "#21BF68"
                                                                            : "#E54B4B",
                                                                }}
                                                            />
                                                            <p>{analytics.websiteAnalytics.status}</p>
                                                        </span>
                                                        <i>
                                                            {analytics.websiteAnalytics.status === 200
                                                                ? "OK"
                                                                : analytics.websiteAnalytics.error || "Error"}
                                                        </i>
                                                    </label>
                                                    <div
                                                        className="productionAnalyticsListItemDivider"
                                                        style={{ marginBottom: 0 }}
                                                    />
                                                </div>

                                                <div>
                                                    <strong>Response Time:</strong>
                                                    <p>{analytics.websiteAnalytics.responseTime} ms</p>
                                                </div>

                                                <div>
                                                    <strong>Page Load Time:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics.performance?.pageLoadTime ?? 0} ms
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Content Length:</strong>
                                                    <p>
                                                        {(analytics.websiteAnalytics.contentLength / 1024).toFixed(2)} KB
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Scripts:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics.performance?.scripts ?? 0}
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Links:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics.performance?.links ?? 0}
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Images:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics.performance?.images ?? 0}
                                                    </p>
                                                </div>

                                                
                                            </div>
                                        ) : (
                                            <p>No website analytics available</p>
                                        )
                                    ) : (
                                        <div className="loading-wrapper">
                                            <div className="loading-circle" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Performance</h2>
                                    <FontAwesomeIcon
                                        icon={faArrowUpRightFromSquare}
                                    />
                                </div>

                                <div
                                    className="productionAnalyticsList"
                                    style={{ alignItems: "center" }}
                                />
                            </div>
                        </div>

                        <div className="productionDeploymentMultiCellFlex">
                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Repository Analytics</h2>
                                    <FontAwesomeIcon
                                        icon={faArrowUpRightFromSquare}
                                    />
                                </div>
                                <div className="productionAnalyticsList">
                                    {analytics ? (
                                        analytics.repositoryAnalytics && (
                                            <div className="productionAnalyticsListItem">
                                                <div className="productionAnalyticsListTitleWrapper">
                                                    <label className="productionAnalyticsListTitle">
                                                        <span>
                                                            <img
                                                                src={
                                                                    analytics
                                                                        .repositoryAnalytics
                                                                        .repoDetails
                                                                        ?.ownerAvatar
                                                                }
                                                                alt=""
                                                            />
                                                            <p>
                                                                {
                                                                    analytics
                                                                        .repositoryAnalytics
                                                                        .repoDetails
                                                                        ?.fullName
                                                                }
                                                            </p>
                                                        </span>
                                                    </label>

                                                    <div
                                                        className="productionAnalyticsListItemDivider"
                                                        style={{
                                                            marginBottom: 0
                                                        }}
                                                    />
                                                </div>

                                                <div>
                                                    <strong>
                                                        <FontAwesomeIcon
                                                            icon={faCodeCommit}
                                                        />{" "}
                                                        Commits:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .repositoryAnalytics
                                                                .stats
                                                                ?.commitCount
                                                        }
                                                    </p>
                                                </div>
                                                <div>
                                                    <strong>
                                                        <FontAwesomeIcon
                                                            icon={faUsers}
                                                        />{" "}
                                                        Contributors:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .repositoryAnalytics
                                                                .stats
                                                                ?.contributorCount
                                                        }
                                                    </p>
                                                </div>
                                                <div>
                                                    <strong>
                                                        <FontAwesomeIcon
                                                            icon={faCodeBranch}
                                                        />{" "}
                                                        Branches:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .repositoryAnalytics
                                                                .stats
                                                                ?.branchCount
                                                        }
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>
                                                        <FontAwesomeIcon
                                                            icon={
                                                                faCodePullRequest
                                                            }
                                                        />{" "}
                                                        Open Pull Requests:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .repositoryAnalytics
                                                                .stats
                                                                ?.openPulls
                                                        }
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>
                                                        <FontAwesomeIcon
                                                            icon={
                                                                faTriangleExclamation
                                                            }
                                                        />{" "}
                                                        Open Issues:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .repositoryAnalytics
                                                                .repoDetails
                                                                ?.issues
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        )
                                    ) : (
                                        <div className="loading-wrapper">
                                            <div className="loading-circle" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Previous Updates</h2>
                                    <FontAwesomeIcon
                                        icon={faArrowUpRightFromSquare}
                                    />
                                </div>
                                <div className="previousDeploymentsList">
                                    {commits &&
                                        commits.map((commit) => (
                                            <div
                                                key={commit.sha}
                                                className="previousCommitItem"
                                                onClick={() => {
                                                    navigate(
                                                        "/update-details",
                                                        {
                                                            state: {
                                                                commitDetails:
                                                                    commit,
                                                                repository:
                                                                    projectDetails
                                                                        .project
                                                                        .repository,
                                                                owner:
                                                                    projectDetails
                                                                        .project
                                                                        .created_by,
                                                                branchName:
                                                                    projectDetails
                                                                        .project
                                                                        .branch
                                                            }
                                                        }
                                                    );
                                                }}
                                            >
                                                <span>
                                                    <p>
                                                        <FontAwesomeIcon
                                                            icon={faCodeCommit}
                                                        />{" "}
                                                        {commit.sha.substring(
                                                            0,
                                                            6
                                                        )}{" "}
                                                        -{" "}
                                                        {
                                                            commit.commit
                                                                .message
                                                        }
                                                    </p>
                                                    <small>
                                                        by{" "}
                                                        {
                                                            commit.commit.author
                                                                .name
                                                        }{" "}
                                                        on{" "}
                                                        {new Date(
                                                            commit.commit.author
                                                                .date
                                                        ).toLocaleDateString()}
                                                    </small>
                                                </span>
                                                <div>
                                                    <img
                                                        src={
                                                            commit.author
                                                                ?.avatar_url
                                                        }
                                                        alt={
                                                            commit.author?.login
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isLoaded && !projectDetails?.project && (
                <div
                    className="projectDetailsCellHeaderContainer"
                    style={{ justifyContent: "center" }}
                >
                    <div className="unavailableWrapper">
                        <img
                            className="unavailableImage"
                            src={"./StackForgeLogo.png"}
                        />
                        <p className="unavailableText">
                            Unable to connect to database. <br />
                            <span>Please try again later.</span>
                        </p>
                    </div>
                </div>
            )}

            {!isLoaded && (
                <div
                    className="projectDetailsCellHeaderContainer"
                    style={{ justifyContent: "center" }}
                >
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}

            {isRollbackModalOpen && (
                <div className="rollbackModalOverlay">
                    <div className="rollbackModalContainer">
                        <div className="rollbackModalHeader">
                            <h2>Instant Rollback</h2>
                            <button onClick={closeRollbackModal}>
                                <FontAwesomeIcon icon={faXmark} />
                            </button>
                        </div>
                        <div className="rollbackModalBody">
                            <p>
                                Rolling back{" "}
                                <a
                                    href={projectDetails.project.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {new URL(projectDetails.project.url).hostname}
                                </a>{" "}
                                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                            </p>
                            <div className="rollbackDeploymentList">
                                {[
                                    projectDetails.deployments.find(
                                        d => d.deployment_id === projectDetails.project.current_deployment
                                    ),
                                    projectDetails.deployments.find(
                                        d => d.deployment_id === projectDetails.project.previous_deployment
                                    )
                                ]
                                    .filter(Boolean)
                                    .map((dep, idx) => (
                                        <div
                                            key={dep.deployment_id}
                                            className={`rollbackDeploymentItem ${selectedDeployment === dep.deployment_id ? "selected" : ""
                                                }`}
                                            onClick={() => setSelectedDeployment(dep.deployment_id)}
                                        >
                                            <div className="deploymentTitle">
                                                <strong>{dep.deployment_id}</strong>
                                                {idx === 0 ? (
                                                    <span className="currentLabel">Current</span>
                                                ) : (
                                                    <span className="previousLabel">Previous</span>
                                                )}
                                            </div>
                                            <div className="deploymentDetails">
                                                <small>
                                                    {projectDetails.project.branch}{" "}
                                                    <FontAwesomeIcon icon={faCodeBranch} /> by {dep.username}
                                                </small>
                                                <small>
                                                    Deployed {new Date(dep.created_at).toLocaleDateString()}
                                                </small>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                        <div className="rollbackModalFooter">
                            <button onClick={closeRollbackModal}>Cancel</button>
                            <button
                                disabled={!selectedDeployment || isRollbackLoading}
                                onClick={confirmRollback}
                            >
                                Continue
                            </button>
                        </div>
                        {isRollbackLoading && (
                            <div
                                className="loading-wrapper"
                                style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    background: "rgba(0, 0, 0, 0.5)",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center"
                                }}
                            >
                                <div className="loading-circle" />
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default StackForgeProjectDetails;