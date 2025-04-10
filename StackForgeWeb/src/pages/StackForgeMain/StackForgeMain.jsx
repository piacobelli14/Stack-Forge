import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
    faCodeBranch
} from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

const StackForgeMain = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [displayMode, setDisplayMode] = useState("grid");
    const [sortOpen, setSortOpen] = useState(false);
    const [addNewOpen, setAddNewOpen] = useState(false);
    const addNewRef = useRef(null);
    const dropdownRef = useRef(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
    const [deployments, setDeployments] = useState([]);

    const [openMenuId, setOpenMenuId] = useState(null);

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                testList();
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
            setScreenSize(window.innerWidth);
            setResizeTrigger((prev) => !prev);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (addNewRef.current && !addNewRef.current.contains(event.target) && dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setAddNewOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [addNewRef, dropdownRef]);

    const testList = async () => {
        const token = localStorage.getItem("token");
        try {
            const response = await fetch("http://localhost:3000/list", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ organizationID })
            });
            const data = await response.json();
            setDeployments(data);
        } catch (error) {
            console.error(error);
        }
    };

    const handleSearchChange = (e) => {
        setSearchText(e.target.value);
    };

    const toggleSortDropdown = () => {
        setSortOpen((prev) => !prev);
        setAddNewOpen(false);
    };

    const handleSortChange = (option) => {
        setSortOption(option);
        setSortOpen(false);
    };

    const toggleAddNewDropdown = () => {
        if (!addNewOpen && addNewRef.current) {
            const rect = addNewRef.current.getBoundingClientRect();
            setDropdownPosition({ top: rect.bottom, left: rect.left });
        }
        setAddNewOpen((prev) => !prev);
        setSortOpen(false);
    };

    const handleAddNewItem = (type) => {
        console.log("Add new:", type);
        setAddNewOpen(false);
    };

    const handleThreeDotClick = (deploymentId) => {
        setOpenMenuId((prev) => (prev === deploymentId ? null : deploymentId));
    };

    const filteredDeployments = deployments.filter((deployment) => {
        const search = searchText.toLowerCase();
        return (
            deployment.project_name.toLowerCase().includes(search) ||
            deployment.domain.toLowerCase().includes(search) ||
            deployment.orgname.toLowerCase().includes(search) ||
            deployment.deployment_id.toLowerCase().includes(search)
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
                    <div className="projectsTopBar">
                        <div className="projectsTopBarSearchContainer">
                            <div className="searchBarWrapper">
                                <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                                <input
                                    type="text"
                                    className="searchInput"
                                    value={searchText}
                                    onChange={handleSearchChange}
                                    placeholder="Search Repositories and Projects..."
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
                                <button
                                    className="addNewButton"
                                    onClick={toggleAddNewDropdown}
                                >
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

                    <div className={`deploymentsContainer ${displayMode}`} style={{"opacity": addNewOpen ? "0.6" : "1.0"}}>
                        {filteredDeployments.map((deployment) => (
                            <div key={deployment.deployment_id} className="deploymentCell">
                                <div className="deploymentCellHeader">
                                    <div className="deploymentCellHeaderLeft">
                                        <div className="deploymentCellHeaderLeftTop">
                                            <img
                                                src="StackForgeLogo.png"
                                                className="deploymentCellProjectImage"
                                            />
                                            <div className="deploymentCellHeaderInfo">
                                                <div className="deploymentCellHeaderProjectName">Placeholder Project Name</div>
                                                <a className="deploymentCellHeaderLink" href={deployment.url} target="_blank" rel="noopener noreferrer">
                                                    {deployment.url}
                                                </a>
                                            </div>
                                        </div>
                                        <a className="deploymentCellHeaderGithub">
                                            <FontAwesomeIcon icon={faGithub}/>
                                            <p>https://github.com/piacobelli14/Dino-Labs-Playground.git</p>
                                        </a>
                                        <div className="deploymentCellHeaderLeftBottom">
                                            <p><span>Current Deployment:</span><br/>{deployment.deployment_id}</p>
                                        </div>
                                    </div>
                                    <div className="deploymentCellHeaderRight">
                                        <div className="threeDotMenuContainer">
                                            <button className="threeDotMenuButton" onClick={() => handleThreeDotClick(deployment.deployment_id)}>
                                                <FontAwesomeIcon icon={faEllipsisH} />
                                            </button>
                                            <div
                                                className="threeDotDropdownMenu"
                                                style={{
                                                    display:
                                                        openMenuId === deployment.deployment_id
                                                            ? "flex"
                                                            : "none"
                                                }}
                                            >
                                                <button>Add Favorite</button>
                                                <button>Visit with Toolbar</button>
                                                <button>View Logs</button>
                                                <button>Manage Domains</button>
                                                <button>Transfer Project</button>
                                                <button>Settings</button>
                                            </div>
                                        </div>
                                        <div className="deploymentCellHeaderUpdate"> 
                                            <strong>update</strong> 
                                            <span>on Jan 28</span>
                                            <a><FontAwesomeIcon icon={faCodeBranch}/> main</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {!isLoaded && (
                <div
                    className="profileCellHeaderContainer"
                    style={{ justifyContent: "center" }}
                >
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
            {addNewOpen && (
                <div className="dropdownMenu" ref={dropdownRef} style={{ top: dropdownPosition.top * 1.05, left: dropdownPosition.left * 0.95 }}>
                    <button onClick={() => handleAddNewItem("Project")}>
                        Project
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                    </button>
                    <button onClick={() => handleAddNewItem("Domain")}>
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
