import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSearch,
    faList,
    faCaretDown,
    faCircleInfo,
    faGrip,
    faArrowUpRightFromSquare,
    faEllipsisH,
    faCodeBranch
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeMain = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [projectsPage, setProjectsPage] = useState("projects");
    const [searchText, setSearchText] = useState("");
    const [displayMode, setDisplayMode] = useState("grid");
    const addNewRef = useRef(null);
    const [addNewOpen, setAddNewOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
    const [projects, setProjects] = useState([]);
    const [openMenuId, setOpenMenuId] = useState(null);

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                getProjects();
                setIsLoaded(true);
            } catch (error) {
                console.error(error);
            }
        };
        if (!loading && token) fetchData();
    }, [userID, loading, token]);

    useEffect(() => {
        const handleResize = () => {
            setIsLoaded(false);
            setAddNewOpen(false);
            setScreenSize(window.innerWidth);
            setResizeTrigger((prev) => !prev);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                addNewRef.current &&
                !addNewRef.current.contains(event.target) &&
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target)
            ) {
                setAddNewOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [addNewRef, dropdownRef]);

    useEffect(() => {
        if (addNewOpen && addNewRef.current && dropdownRef.current) {
            const buttonRect = addNewRef.current.getBoundingClientRect();
            const dropdownRect = dropdownRef.current.getBoundingClientRect();
            let newTop = buttonRect.bottom + 5;
            let newLeft = buttonRect.right - dropdownRect.width;
            if (newTop + dropdownRect.height > window.innerHeight) {
                newTop = window.innerHeight - dropdownRect.height;
            }
            if (newLeft < 0) {
                newLeft = 0;
            }
            setDropdownPosition({ top: newTop, left: newLeft });
        }
    }, [addNewOpen]);

    const getProjects = async () => {
        const token = localStorage.getItem("token");
        try {
            const response = await fetch("http://localhost:3000/list-projects", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ organizationID })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log("Received projects:", data);
            setProjects(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching projects:", error);
            setProjects([]);
        }
    };

    const handleSearchChange = (e) => {
        setSearchText(e.target.value);
    };

    const toggleAddNewDropdown = () => {
        setAddNewOpen((prev) => !prev);
    };

    const handleAddNewItem = (type) => {
        c
        setAddNewOpen(false);
    };

    const handleThreeDotClick = (projectId) => {
        setOpenMenuId((prev) => (prev === projectId ? null : projectId));
    };

    const filteredProjects = projects.filter((project) => {
        if (!project) return false;
        const search = searchText.toLowerCase();
        return (
            (project.name && project.name.toLowerCase().includes(search)) ||
            (project.project_id && project.project_id.toLowerCase().includes(search))
        );
    });

    return (
        <div
            className="loginPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="projectsCellHeaderContainer">
                    <div className="projectsNavBar">
                        <button
                            style={{
                                borderBottom: projectsPage === "projects" ? "2px solid #f5f5f5" : "none",
                                color: projectsPage === "projects" ? "#f5f5f5" : ""
                            }}
                            onClick={() => {
                                setProjectsPage("projects");
                            }}
                        >
                            Projects
                        </button>
                        <button
                            style={{
                                borderBottom: projectsPage === "activity" ? "2px solid #f5f5f5" : "none",
                                color: projectsPage === "activity" ? "#f5f5f5" : ""
                            }}
                            onClick={() => {
                                setProjectsPage("activity");
                            }}
                        >
                            Activity
                        </button>
                        <button
                            style={{
                                borderBottom: projectsPage === "domains" ? "2px solid #f5f5f5" : "none",
                                color: projectsPage === "domains" ? "#f5f5f5" : ""
                            }}
                            onClick={() => {
                                setProjectsPage("domains");
                            }}
                        >
                            Domains
                        </button>
                        <button
                            style={{
                                borderBottom: projectsPage === "usage" ? "2px solid #f5f5f5" : "none",
                                color: projectsPage === "usage" ? "#f5f5f5" : ""
                            }}
                            onClick={() => {
                                setProjectsPage("usage");
                            }}
                        >
                            Usage
                        </button>
                        <button
                            style={{
                                borderBottom: projectsPage === "monitoring" ? "2px solid #f5f5f5" : "none",
                                color: projectsPage === "monitoring" ? "#f5f5f5" : ""
                            }}
                            onClick={() => {
                                setProjectsPage("monitoring");
                            }}
                        >
                            Monitoring
                        </button>
                    </div>
                    {projectsPage === "projects" && (
                        <div className="projectsTopBar">
                            <div className="projectsTopBarSearchContainer">
                                <div className="searchBarWrapper">
                                    <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                                    <input
                                        type="text"
                                        className="searchInput"
                                        value={searchText}
                                        onChange={handleSearchChange}
                                        placeholder="Search Projects..."
                                    />
                                    <FontAwesomeIcon icon={faCircleInfo} className="searchIconSupplement" />
                                </div>
                            </div>
                            <div className="projectsTopBarControls">
                                <div className="viewControlButtonWrapper">
                                    <button
                                        className={`viewControlButton ${displayMode === "grid" ? "active" : ""}`}
                                        onClick={() => {
                                            setDisplayMode("grid");
                                        }}
                                    >
                                        <FontAwesomeIcon icon={faGrip} />
                                    </button>
                                    <button
                                        className={`viewControlButton ${displayMode === "list" ? "active" : ""}`}
                                        onClick={() => {
                                            setDisplayMode("list");
                                        }}
                                    >
                                        <FontAwesomeIcon icon={faList} />
                                    </button>
                                </div>
                                <div className="addNewWrapper" ref={addNewRef}>
                                    <button className="addNewButton" onClick={toggleAddNewDropdown}>
                                        Add New...
                                        <FontAwesomeIcon
                                            icon={faCaretDown}
                                            className="addNewCaretIcon"
                                            style={{
                                                transform: addNewOpen ? "rotate(180deg)" : "rotate(0deg)",
                                                transition: "transform 0.3s ease"
                                            }}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {projectsPage === "projects" && (
                        <div className={`deploymentsContainer ${displayMode}`} style={{ opacity: addNewOpen ? "0.6" : "1.0" }}>
                            {filteredProjects.map((project) => (
                                <div key={project.project_id} className="deploymentCell">
                                    <div className="deploymentCellHeaderTop">
                                        <div className="deploymentCellHeaderLeft">
                                            <div className="deploymentCellHeaderLeftTop">
                                                <img src={project.image || "StackForgeLogo.png"} className="deploymentCellProjectImage" />
                                                <div className="deploymentCellHeaderInfo">
                                                    <div className="deploymentCellHeaderProjectName">
                                                        {project.name || 'Unnamed Project'}
                                                    </div>
                                                    <a
                                                        className="deploymentCellHeaderLink"
                                                        href={project.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        {project.url}
                                                    </a>
                                                </div>
                                            </div>
                                            {project.repository ? (
                                                <a className="deploymentCellHeaderGithub" href={project.repository}>
                                                    <FontAwesomeIcon icon={faGithub} />
                                                    <p>{project.repository}</p>
                                                </a>
                                            ) : (
                                                <a className="deploymentCellHeaderGithub" href={project.repository}>
                                                    <FontAwesomeIcon icon={faGithub} />
                                                    <p>No repository connected.</p>
                                                </a>
                                            )}
                                        </div>
                                        <div className="deploymentCellHeaderRight">
                                            <div className="threeDotMenuContainer">
                                                <button className="threeDotMenuButton" onClick={() => handleThreeDotClick(project.project_id)}>
                                                    <FontAwesomeIcon icon={faEllipsisH} />
                                                </button>
                                                {openMenuId === project.project_id && (
                                                    <div className="threeDotDropdownMenu">
                                                        <button>Add Favorite</button>
                                                        <button>Visit Project</button>
                                                        <button>View Project Details</button>
                                                        <button>Manage Repository</button>
                                                        <button>Transfer Project</button>
                                                        <button>Settings</button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="deploymentCellHeaderBottom">
                                        <div className="deploymentCellHeaderLeftBottom">
                                            <p>
                                                <span>Project ID:</span>
                                                <br />
                                                {project.project_id}
                                            </p>
                                        </div>
                                        <div className="deploymentCellHeaderUpdate">
                                            <strong>Last updated:</strong>
                                            <span>{new Date(project.updated_at).toLocaleDateString()}</span>
                                            <a>
                                                <FontAwesomeIcon icon={faCodeBranch} /> main
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {!isLoaded && (
                <div className="profileCellHeaderContainer" style={{ justifyContent: "center" }}>
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
            {addNewOpen && (
                <div className="dropdownMenu" ref={dropdownRef} style={{ top: dropdownPosition.top * 1.05, left: dropdownPosition.left }}>
                    <button onClick={() => navigate("/add-new-project")}>
                        Project
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                    <button onClick={() => navigate("/add-new-domain")}>
                        Domain
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                    <button onClick={() => handleAddNewItem("Store")}>
                        Store
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                    <button onClick={() => handleAddNewItem("Team Member")}>
                        Team Member
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default StackForgeMain;
