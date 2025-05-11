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
    faXmark,
    faCheckToSlot,
    faExclamationTriangle,
    faMagnifyingGlass,
    faXmarkSquare
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
    const [searchTerm, setSearchTerm] = useState("");
    const [projectDetails, setProjectDetails] = useState(null);
    const [snapshotUrl, setSnapshotUrl] = useState(null);
    const [commits, setCommits] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [isRollbackModalOpen, setRollbackModalOpen] = useState(false);
    const [selectedDeployment, setSelectedDeployment] = useState(null);
    const [isRollbackLoading, setIsRollbackLoading] = useState(false);
    const [updateMismatch, setUpdateMismatch] = useState(null);
    const [selectedSubdomain, setSelectedSubdomain] = useState(null);
    const projectID = location.state?.projectID;
    const repository = location.state?.repository;
    const [domainSearchState, setDomainSearchState] = useState(false);
    const getFullDomainName = (sub) =>
        sub && sub.endsWith(".stackforgeengine.com")
            ? sub
            : `${sub}.stackforgeengine.com`;
    const filteredDomains =
        projectDetails?.domains?.filter((d) =>
            d.domain_name.toLowerCase().includes(searchTerm.toLowerCase())
        ) ?? [];

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
        if (projectDetails && projectDetails.project && selectedSubdomain) {
            fetchCommits();
            fetchUpdateMismatch();
        }
    }, [projectDetails, selectedSubdomain]);

    useEffect(() => {
        if (projectDetails?.domains?.length > 0) {
            setSelectedSubdomain(projectDetails.domains[0].domain_name);
        }
    }, [projectDetails]);

    useEffect(() => {
        if (selectedSubdomain) {
            setSnapshotUrl(null);
            setAnalytics(null);
            fetchSnapshot();
            fetchAnalytics();
        }
    }, [selectedSubdomain]);

    const fetchProjectInfo = async () => {
        try {
            const response = await fetch("http://localhost:3000/project-details", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    organizationID,
                    userID,
                    projectID,
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch project details");
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
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    domainName: selectedSubdomain,
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch snapshot");
            const blob = await response.blob();
            setSnapshotUrl(URL.createObjectURL(blob));
        } catch (error) { }
    };

    const fetchUpdateMismatch = async () => {
        if (!selectedSubdomain) return;
        try {
            const response = await fetch("http://localhost:3000/git-repo-updates", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userID,
                    organizationID,
                    owner: projectDetails.project.created_by,
                    repo: projectDetails.project.repository,
                    projectID,
                    domainName: selectedSubdomain,
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch update mismatch");
            const data = await response.json();
            setUpdateMismatch(data);
        } catch (error) { }
    };

    const fetchCommits = async () => {
        if (!selectedSubdomain) return;
        try {
            const response = await fetch("http://localhost:3000/git-commits", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userID,
                    organizationID,
                    projectID,
                    owner: projectDetails.project.created_by,
                    repo: projectDetails.project.repository,
                    domainName: selectedSubdomain,
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch commits");
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
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userID,
                    domainName: selectedSubdomain,
                    websiteURL: `https://${getFullDomainName(selectedSubdomain)}`,
                    repository: projectDetails.project.repository,
                    owner: projectDetails.project.created_by,
                    projectName: projectDetails.project.name,
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch analytics");
            const data = await response.json();
            setAnalytics(data);
        } catch (error) { }
    };

    const openRollbackModal = () => {
        setSelectedDeployment(projectDetails.project.previous_deployment);
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
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    organizationID,
                    userID,
                    projectID,
                    deploymentID: selectedDeployment,
                }),
            });
            setIsRollbackLoading(false);
            closeRollbackModal();
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(
                    errorData.message ||
                    `Rollback failed with status ${response.status}`
                );
            }
            const data = await response.json();
            showDialog({
                title: "Success",
                message:
                    data.message || "Rollback completed successfully",
                showCancel: false,
            });
        } catch (error) {
            showDialog({
                title: "Error",
                message:
                    error.message ||
                    "An unexpected error occurred during rollback",
                showCancel: false,
            });
        }
        await fetchProjectInfo();
        setTimeout(() => {
            setIsRollbackLoading(false);
            setRollbackModalOpen(false);
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

    const fullDomainName = selectedSubdomain
        ? getFullDomainName(selectedSubdomain)
        : "";
    const currentDomainUrl = selectedSubdomain
        ? `https://${fullDomainName}`
        : "#";

    return (
        <div
            className="projectDetailsPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : "",
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
                            <button
                                onClick={() => {
                                    navigate("/project-settings", {
                                        state: {
                                            project: projectDetails.project,
                                            settingsState: "domains",
                                        },
                                    });
                                }}
                            >
                                <p>Domains</p>
                            </button>
                        </span>
                    </div>

                    <div className="projectDetailsTopBarSupplement">
                        <div className={domainSearchState ? "projectDetailsSearchContainerSearchMode" : "projectDetailsSearchContainer"}>
                            {domainSearchState ? (
                                <div className="projectDetailsSearchBarWrapper">
                                    <FontAwesomeIcon
                                        icon={faSearch}
                                        className="projectDetailsSearchIcon"
                                    />
                                    <input
                                        type="text"
                                        className="projectDetailsSearchInput"
                                        placeholder="Search subdomains..."
                                        value={searchTerm}
                                        onChange={(e) =>
                                            setSearchTerm(e.target.value)
                                        }
                                    />
                                    <FontAwesomeIcon
                                        icon={faXmarkSquare}
                                        className="projectDetailsSearchIconSupplement"
                                        onClick={() => { setDomainSearchState(false) }}
                                    />
                                </div>
                            ) : (
                                <>
                                    <small>You have {projectDetails?.domains?.length} subdomains on this project.</small>

                                    <button onClick={() => { setDomainSearchState(true) }}>
                                        <FontAwesomeIcon icon={faMagnifyingGlass} />
                                    </button>
                                </>
                            )}


                        </div>

                        <div className="projectDetailsNavContainer">
                            <span>
                                {filteredDomains.map((domain) => (
                                    <button
                                        key={
                                            domain.domain_id ??
                                            domain.domain_name
                                        }
                                        onClick={() =>
                                            setSelectedSubdomain(
                                                domain.domain_name
                                            )
                                        }
                                        style={
                                            selectedSubdomain ===
                                                domain.domain_name
                                                ? {
                                                    borderBottom:
                                                        "1px solid #c1c1c1",
                                                    color: "#f5f5f5",
                                                }
                                                : {
                                                    borderBottom:
                                                        "2px solid transparent",
                                                    color: "#8c8c8c",
                                                }
                                        }
                                    >
                                        {domain.domain_name}
                                    </button>
                                ))}
                            </span>
                        </div>
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
                                                    deploymentID:
                                                        projectDetails.project
                                                            .current_deployment,
                                                },
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
                                                    deploymentID:
                                                        projectDetails.project
                                                            .current_deployment,
                                                },
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
                                            href={currentDomainUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <img src={snapshotUrl} alt="" />
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
                                        <span>
                                            {
                                                projectDetails.project
                                                    .current_deployment
                                            }
                                        </span>
                                    </div>

                                    <div className="deploymentDetailLine">
                                        <strong>Current Subdomain</strong>
                                        <span
                                            className="deploymentDetailLineDomainsSpan"
                                            onClick={() => {
                                                navigate("/project-settings", {
                                                    state: {
                                                        project: projectDetails.project,
                                                        settingsState: "domains",
                                                    },
                                                });
                                            }}
                                        >
                                            {selectedSubdomain}
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
                                                                    "#21BF68",
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
                                                                    "#E54B4B",
                                                            }}
                                                        ></span>
                                                        {projectDetails
                                                            .deployments[0]
                                                            ?.status?.charAt(0)
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
                                    <FontAwesomeIcon
                                        icon={faArrowUpRightFromSquare}
                                    />
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
                                                                        analytics.websiteAnalytics
                                                                            .status ===
                                                                            200
                                                                            ? "#21BF68"
                                                                            : "#E54B4B",
                                                                }}
                                                            />
                                                            <p>
                                                                {
                                                                    analytics
                                                                        .websiteAnalytics
                                                                        .status
                                                                }
                                                            </p>
                                                        </span>
                                                        <i>
                                                            {analytics
                                                                .websiteAnalytics
                                                                .status === 200
                                                                ? "OK"
                                                                : analytics
                                                                    .websiteAnalytics
                                                                    .error ||
                                                                "Error"}
                                                        </i>
                                                    </label>
                                                    <div
                                                        className="productionAnalyticsListItemDivider"
                                                        style={{
                                                            marginBottom: 0,
                                                        }}
                                                    />
                                                </div>

                                                <div>
                                                    <strong>
                                                        Response Time:
                                                    </strong>
                                                    <p>
                                                        {
                                                            analytics
                                                                .websiteAnalytics
                                                                .responseTime
                                                        }{" "}
                                                        ms
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>
                                                        Page Load Time:
                                                    </strong>
                                                    <p>
                                                        {analytics.websiteAnalytics
                                                            .performance
                                                            ?.pageLoadTime ?? 0}{" "}
                                                        ms
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>
                                                        Content Length:
                                                    </strong>
                                                    <p>
                                                        {(
                                                            analytics
                                                                .websiteAnalytics
                                                                .contentLength /
                                                            1024
                                                        ).toFixed(2)}{" "}
                                                        KB
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Scripts:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics
                                                            .performance
                                                            ?.scripts ?? 0}
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Links:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics
                                                            .performance
                                                            ?.links ?? 0}
                                                    </p>
                                                </div>

                                                <div>
                                                    <strong>Images:</strong>
                                                    <p>
                                                        {analytics.websiteAnalytics
                                                            .performance
                                                            ?.images ?? 0}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="noProjectUpdatesAvailableWrapper">
                                                <FontAwesomeIcon
                                                    icon={faExclamationTriangle}
                                                />
                                                <strong>
                                                    No website analytics
                                                    available.
                                                </strong>
                                                <p>
                                                    Check your domain's status
                                                    as it may be down.
                                                </p>
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
                                    <h2>
                                        Staged Updates{" "}
                                        <FontAwesomeIcon
                                            icon={faInfoCircle}
                                        />
                                    </h2>
                                    <FontAwesomeIcon
                                        icon={faArrowUpRightFromSquare}
                                    />
                                </div>

                                {updateMismatch &&
                                    updateMismatch.hasUpdates ? (
                                    <div className="projectUpdatesAvailableWrapper">
                                        <div
                                            className="projectUpdatesAvailableWrapperHeader"
                                            onClick={() => {
                                                navigate("/update-details", {
                                                    state: {
                                                        commitDetails:
                                                            updateMismatch
                                                                .newCommits[0],
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
                                                                .project.branch,
                                                        projectID: projectID,
                                                        projectName:
                                                            projectDetails
                                                                .project.name,
                                                        domainName:
                                                            selectedSubdomain
                                                    },
                                                });
                                            }}
                                        >
                                            <span>
                                                <strong>
                                                    Most Recent Update:
                                                </strong>
                                                <p>
                                                    <FontAwesomeIcon
                                                        icon={faCodeCommit}
                                                    />{" "}
                                                    {updateMismatch.newCommits[0].sha.substring(
                                                        0,
                                                        6
                                                    )}{" "}
                                                    -{" "}
                                                    {
                                                        updateMismatch
                                                            .newCommits[0]
                                                            .commit.message
                                                    }
                                                </p>
                                                <small>
                                                    by{" "}
                                                    {
                                                        updateMismatch
                                                            .newCommits[0]
                                                            .commit.author.name
                                                    }{" "}
                                                    on{" "}
                                                    {new Date(
                                                        updateMismatch
                                                            .newCommits[0]
                                                            .commit.author.date
                                                    ).toLocaleDateString()}
                                                </small>
                                            </span>

                                            <img
                                                src={
                                                    updateMismatch.newCommits[0]
                                                        .author?.avatar_url
                                                }
                                                alt=""
                                            />
                                        </div>

                                        <label>
                                            Other available deployment updates:
                                        </label>

                                        <div className="projectUpdatesAvailableWrapperContent">
                                            {updateMismatch.newCommits
                                                .slice(1)
                                                .sort(
                                                    (a, b) =>
                                                        new Date(
                                                            b.commit.author.date
                                                        ) -
                                                        new Date(
                                                            a.commit.author.date
                                                        )
                                                )
                                                .map((commit) => (
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
                                                                                .branch,
                                                                        projectID: projectID,
                                                                        projectName:
                                                                            projectDetails
                                                                                .project
                                                                                .name,
                                                                        domainName:
                                                                            selectedSubdomain
                                                                    },
                                                                }
                                                            );
                                                        }}
                                                    >
                                                        <span>
                                                            <p>
                                                                <FontAwesomeIcon
                                                                    icon={
                                                                        faCodeCommit
                                                                    }
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
                                                                    commit.commit
                                                                        .author
                                                                        .name
                                                                }{" "}
                                                                on{" "}
                                                                {new Date(
                                                                    commit
                                                                        .commit
                                                                        .author
                                                                        .date
                                                                ).toLocaleDateString()}
                                                            </small>
                                                        </span>
                                                        <div>
                                                            <img
                                                                src={
                                                                    commit
                                                                        .author
                                                                        ?.avatar_url
                                                                }
                                                                alt=""
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="productionAnalyticsList">
                                        <div className="noProjectUpdatesAvailableWrapper">
                                            <FontAwesomeIcon
                                                icon={faCheckToSlot}
                                            />
                                            <strong>
                                                No staged updates available.
                                            </strong>
                                            <p>
                                                If you'd like to update one of
                                                your deployments push a commit
                                                to the project's Git repository.
                                            </p>
                                        </div>
                                    </div>
                                )}
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
                                                            marginBottom: 0,
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
                                    {commits ?
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
                                                                        .branch,
                                                                projectID:
                                                                    projectID,
                                                                projectName:
                                                                    projectDetails
                                                                        .project
                                                                        .name,
                                                                domainName:
                                                                    selectedSubdomain
                                                            },
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
                                                        alt=""
                                                    />
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
                                    href={currentDomainUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {currentDomainUrl.replace(
                                        /^https?:\/\//,
                                        ""
                                    )}
                                </a>{" "}
                                <FontAwesomeIcon
                                    icon={faArrowUpRightFromSquare}
                                />
                            </p>
                            <div className="rollbackDeploymentList">
                                {[
                                    projectDetails.deployments.find(
                                        (d) =>
                                            d.deployment_id ===
                                            projectDetails.project
                                                .current_deployment
                                    ),
                                    projectDetails.deployments.find(
                                        (d) =>
                                            d.deployment_id ===
                                            projectDetails.project
                                                .previous_deployment
                                    ),
                                ]
                                    .filter(Boolean)
                                    .map((dep, idx) => (
                                        <div
                                            key={dep.deployment_id}
                                            className={`rollbackDeploymentItem ${selectedDeployment ===
                                                    dep.deployment_id
                                                    ? "selected"
                                                    : ""
                                                }`}
                                            onClick={() =>
                                                setSelectedDeployment(
                                                    dep.deployment_id
                                                )
                                            }
                                        >
                                            <div className="deploymentTitle">
                                                <strong>
                                                    {dep.deployment_id}
                                                </strong>
                                                {idx === 0 ? (
                                                    <span className="currentLabel">
                                                        Current
                                                    </span>
                                                ) : (
                                                    <span className="previousLabel">
                                                        Previous
                                                    </span>
                                                )}
                                            </div>
                                            <div className="deploymentDetails">
                                                <small>
                                                    {projectDetails.project
                                                        .branch}{" "}
                                                    <FontAwesomeIcon
                                                        icon={faCodeBranch}
                                                    />{" "}
                                                    by {dep.username}
                                                </small>
                                                <small>
                                                    Deployed{" "}
                                                    {new Date(
                                                        dep.created_at
                                                    ).toLocaleDateString()}
                                                </small>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                        <div className="rollbackModalFooter">
                            <button onClick={closeRollbackModal}>Cancel</button>
                            <button
                                disabled={
                                    !selectedDeployment || isRollbackLoading
                                }
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
                                    alignItems: "center",
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
