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
    faCodeBranch,
    faArrowRightArrowLeft
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeAddProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeAddProject = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const importNewRef = useRef(null);
    const [importNewOpen, setImportNewOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
    const [searchTerm, setSearchTerm] = useState('');
    const repositoryData = [
        { name: "Vektor-Web-API", date: "Apr 7" },
        { name: "Vektor-API", date: "Apr 7" },
        { name: "VektorODS", date: "Apr 7" },
        { name: "Nightingale-Web", date: "Jan 28" },
        { name: "Nightingale-Bookkeeper", date: "Jan 28" },
    ];
    const filteredRepositories = repositoryData.filter(repo =>
        repo.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
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
            setImportNewOpen(false);
            setScreenSize(window.innerWidth);
            setResizeTrigger((prev) => !prev);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (importNewOpen && importNewRef.current && dropdownRef.current) {
            const buttonRect = importNewRef.current.getBoundingClientRect();
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
    }, [importNewOpen]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                importNewRef.current &&
                !importNewRef.current.contains(event.target) &&
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target)
            ) {
                setImportNewOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [dropdownRef]);

    const toggleAddNewDropdown = () => {
        setImportNewOpen((prev) => !prev);
    };

    return (
        <div
            className="addProjectsPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="addProjectsCellHeaderContainer">
                    <div className="addProjectsFlexCellWrapper">
                        <div className="addProjectsFlexCell">
                            <div className="addProjectsCellHeader">
                                <div className="addprojectsCellTitleSupplement">
                                    <div className="importNewWrapper">
                                        <button className="importNewButton" ref={importNewRef} onClick={toggleAddNewDropdown}>
                                            <FontAwesomeIcon icon={faGithub} />
                                            <p>
                                                Nightingale-Health
                                            </p>
                                            <FontAwesomeIcon
                                                icon={faCaretDown}
                                                className="importNewCaretIcon"
                                                style={{
                                                    transform: importNewOpen ? "rotate(180deg)" : "rotate(0deg)",
                                                    transition: "transform 0.3s ease"
                                                }}
                                            />
                                        </button>
                                        <div className="importSearchBarWrapper">
                                            <FontAwesomeIcon icon={faSearch} className="importSearchIcon" />
                                            <input
                                                type="text"
                                                className="importSearchInput"
                                                placeholder="Search Repositories..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="addProjectsTopBarSearchContainer">
                                    </div>
                                </div>
                            </div>
                            <div className="addProjectsCellContent" style={{"opacity": importNewOpen ? "0.6" : "1.0"}}>
                                <div className="addProjectsContentListCellWrapper">
                                    {filteredRepositories.map((repo, index) => (
                                        <div className="repoItem" key={index}>
                                            <div className="repoNameDate">
                                                <p className="repoName">{repo.name}</p>
                                                <p className="repoDate">{repo.date}</p>
                                            </div>
                                            <button className="importButton">Import</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="addProjectsFlexCell">
                            <div className="addProjectsCellHeader">
                                <p className="addProjectsCellTitle">
                                    Clone Template
                                </p>
                            </div>
                            <div className="addProjectsCellContent">
                                <div className="templateList">
                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p>Next.js Boilerplate</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p >AI Chatbot</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p>Commerce</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p>Vite + React Starter</p>
                                    </div>

                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p>Commerce</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"}/>
                                        <p>Vite + React Starter</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {!isLoaded && (
                <div className="addProjectsCellHeaderContainer" style={{ justifyContent: "center" }}>
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
            {importNewOpen && (
                <div className="dropdownMenu" ref={dropdownRef} style={{ top: dropdownPosition.top * 1.02, left: dropdownPosition.left }}>
                    <button onClick={() => navigate("/add-new-project")}>
                        Connect New Github
                        <FontAwesomeIcon icon={faGithub} />
                    </button>
                    <button onClick={() => navigate("/add-new-domain")}>
                        Switch Git Provider
                        <FontAwesomeIcon icon={faArrowRightArrowLeft} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default StackForgeAddProject;
