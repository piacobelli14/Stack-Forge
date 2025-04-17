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
    faCaretRight
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjectDetails.css";
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
        } catch (error) {
            console.error(error);
        }
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
        } catch (error) {
            console.error(error);
        }
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
        } catch (error) {
            console.error(error);
        }
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
                    owner: projectDetails.project.created_by
                })
            });
            if (!response.ok) {
                throw new Error("Failed to fetch analytics");
            }
            const data = await response.json();
            setAnalytics(data);
        } catch (error) {
            console.error("Error fetching analytics:", error);
        }
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
                            <button>
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
                                    <button>
                                        <FontAwesomeIcon icon={faHammer} />
                                        Build Logs
                                    </button>
                                    <button>
                                        <FontAwesomeIcon icon={faGaugeHigh} />
                                        Runtime Logs
                                    </button>
                                    <button>
                                        <FontAwesomeIcon icon={faArrowRotateLeft} />
                                        Instant Rollback
                                    </button>
                                </div>
                            </div>
                            <div className="productionDeploymentBody">
                                <div className="productionDeploymentScreenshot">
                                    {snapshotUrl ? (
                                        <img src={snapshotUrl} alt="Deployment Snapshot" />
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
                                        <span>{projectDetails.deployments[0]?.deployment_id}</span>
                                    </div>
                                    <div className="deploymentDetailLine">
                                        <strong>Domains</strong>
                                        <span>
                                            {projectDetails.domains[0]?.domain_name}
                                            {projectDetails.domains.length > 1
                                                ? ` +${projectDetails.domains.length - 1}`
                                                : ""}
                                        </span>
                                    </div>
                                    <div className="deploymentDetailLineFlex">
                                        <div className="deploymentDetailLine">
                                            <strong>Status</strong>
                                            <span>
                                                {projectDetails.deployments[0]?.status === "active" ? (
                                                    <>
                                                        <span
                                                            className="statusDot"
                                                            style={{ backgroundColor: "#21BF68" }}
                                                        ></span>
                                                        Ready
                                                    </>
                                                ) : (
                                                    <>
                                                        <span
                                                            className="statusDot"
                                                            style={{ backgroundColor: "#E54B4B" }}
                                                        ></span>
                                                        {projectDetails.deployments[0]?.status}
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                        <div className="deploymentDetailLine">
                                            <strong>Created</strong>
                                            <span>
                                                {new Date(
                                                    projectDetails.deployments[0]?.created_at
                                                ).toLocaleDateString()}{" "}
                                                by {projectDetails.deployments[0]?.username}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="deploymentDetailLine">
                                        <strong>Source</strong>
                                        <span>
                                            <p>
                                                <FontAwesomeIcon icon={faCodeBranch} />{" "}
                                                {projectDetails.project.branch} <br />
                                            </p>
                                            <p>
                                                <FontAwesomeIcon icon={faCodeCommit} />{" "}
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
                                        Fluid Compute
                                    </p>
                                    <p>
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            style={{ color: "#21BF68" }}
                                        />
                                        Deployment Protection
                                    </p>
                                    <p>
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            style={{ color: "#21BF68" }}
                                        />
                                        Skew Protection
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="productionDeploymentMultiCellFlex">
                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Previous Deployments</h2>
                                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </div>
                                <div className="previousDeploymentsList">
                                    {commits.map((commit) => (
                                        <div key={commit.sha} className="previousCommitItem">
                                            <span>
                                                <p>
                                                    <FontAwesomeIcon icon={faCodeCommit} />{" "}
                                                    {commit.sha.substring(0, 6)} -{" "}
                                                    {commit.commit.message}
                                                </p>
                                                <small>
                                                    by {commit.commit.author.name} on{" "}
                                                    {new Date(
                                                        commit.commit.author.date
                                                    ).toLocaleDateString()}
                                                </small>
                                            </span>
                                            <div>
                                                <img
                                                    src={commit.author?.avatar_url}
                                                    alt={commit.author?.login}
                                                    className="commitAvatar"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="productionDeploymentCellShort">
                                <div className="productionDeploymentCellShortHeader">
                                    <h2>Analytics</h2>
                                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </div>
                                <div className="productionAnalyticsList">
                                    {analytics ? (
                                        <>
                                            {analytics.websiteAnalytics && (
                                                <div className="productionAnalyticsListItem">
                                                    <div>
                                                        <strong>Status:</strong>
                                                        <span>
                                                            <i
                                                                className="statusDot"
                                                                style={{
                                                                    backgroundColor:
                                                                        analytics.websiteAnalytics.status ===
                                                                            200
                                                                            ? "#21BF68"
                                                                            : "#E54B4B"
                                                                }}
                                                            ></i>
                                                            <p>
                                                                {analytics.websiteAnalytics.status === 200
                                                                    ? "OK"
                                                                    : analytics.websiteAnalytics.status}
                                                            </p>
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <strong>Response Time:</strong>
                                                        <p>
                                                            {analytics.websiteAnalytics.responseTime} ms
                                                        </p>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="productionAnalyticsListItemDivider" />

                                            {analytics.repositoryAnalytics && (
                                                <div className="productionAnalyticsListItem">
                                                    <div>
                                                        <strong>Name:</strong>
                                                        <p>
                                                            {analytics.repositoryAnalytics.full_name}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <strong>Stars:</strong>
                                                        <p>
                                                            {analytics.repositoryAnalytics.stargazers_count}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <strong>Forks:</strong>
                                                        <p>
                                                            {analytics.repositoryAnalytics.forks_count}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <strong>Open Issues:</strong>
                                                        <p>
                                                            {analytics.repositoryAnalytics.open_issues_count}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="loading-wrapper">
                                        <div className="loading-circle" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {isLoaded && !projectDetails?.project && (
                <div
                    className="addProjectsCellHeaderContainer"
                    style={{ justifyContent: "center" }}
                >
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
            {!isLoaded && (
                <div
                    className="addProjectsCellHeaderContainer"
                    style={{ justifyContent: "center" }}
                >
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StackForgeProjectDetails;
