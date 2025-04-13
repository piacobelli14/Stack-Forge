import { useState, useEffect, useRef } from "react";
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
  faXmarkSquare,
  faCheckDouble
} from "@fortawesome/free-solid-svg-icons";
import { faGit, faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeImportProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav.jsx";
import { showDialog } from "../../helpers/StackForgeAlert.jsx";
import useAuth from "../../UseAuth.jsx";
import useIsTouchDevice from "../../TouchDevice.jsx";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";

const StackForgeImportProject = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTouchDevice = useIsTouchDevice();
  const { token, userID, loading, organizationID } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [resizeTrigger, setResizeTrigger] = useState(false);
  const scrollableContainerRef = useRef(null);
  const repository = location.state?.repository;
  const personalName = location.state?.personalName;
  const personalImage = location.state?.personalImage;
  const teamName = location.state?.teamName;
  const teamImage = location.state?.teamImage;
  const gitUsername = location.state?.gitUsername;
  const gitID = location.state?.gitID;
  const changeTeamOpenRef = useRef(null);
  const [changeTeamOpen, setChangeTeamOpen] = useState(false);
  const changeTeamDropdownRef = useRef(null);
  const [changeTeamDropdownPosition, setChangeTeamDropdownPosition] = useState({ top: 0, left: 0 });
  const branchOpenRef = useRef(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const branchDropdownRef = useRef(null);
  const [branchDropdownPosition, setBranchDropdownPosition] = useState({ top: 0, left: 0 });
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [changeEnvironmentOpen, setChangeEnvironmentOpen] = useState(false);
  const [envVars, setEnvVars] = useState([]);

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        fetchBranches();
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
      setChangeTeamOpen(false);
      setBranchOpen(false);
      setScreenSize(window.innerWidth);
      setResizeTrigger(prev => !prev);
      setTimeout(() => setIsLoaded(true), 300);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        changeTeamOpenRef.current &&
        !changeTeamOpenRef.current.contains(event.target) &&
        changeTeamDropdownRef.current &&
        !changeTeamDropdownRef.current.contains(event.target)
      ) {
        setChangeTeamOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [changeTeamOpenRef, changeTeamDropdownRef]);

  useEffect(() => {
    if (changeTeamOpen && changeTeamOpenRef.current && changeTeamDropdownRef.current) {
      const buttonRect = changeTeamOpenRef.current.getBoundingClientRect();
      const dropdownRect = changeTeamDropdownRef.current.getBoundingClientRect();
      let newTop = buttonRect.bottom + 5;
      let newLeft = buttonRect.right - dropdownRect.width;
      if (newTop + dropdownRect.height > window.innerHeight) {
        newTop = window.innerHeight - dropdownRect.height;
      }
      if (newLeft < 0) {
        newLeft = 0;
      }
      setChangeTeamDropdownPosition({ top: newTop, left: newLeft });
    }
  }, [changeTeamOpen]);

  useEffect(() => {
    if (branchOpen && branchOpenRef.current && branchDropdownRef.current) {
      const buttonRect = branchOpenRef.current.getBoundingClientRect();
      const dropdownRect = branchDropdownRef.current.getBoundingClientRect();
      let newTop = buttonRect.bottom + 5;
      let newLeft = buttonRect.left;
      if (newTop + dropdownRect.height > window.innerHeight) {
        newTop = window.innerHeight - dropdownRect.height;
      }
      if (newLeft + dropdownRect.width > window.innerWidth) {
        newLeft = window.innerWidth - dropdownRect.width;
      }
      setBranchDropdownPosition({ top: newTop, left: newLeft });
    }
  }, [branchOpen]);

  useEffect(() => {
    const handleClickOutsideBranch = (event) => {
      if (
        branchOpenRef.current &&
        !branchOpenRef.current.contains(event.target) &&
        branchDropdownRef.current &&
        !branchDropdownRef.current.contains(event.target)
      ) {
        setBranchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutsideBranch);
    return () => document.removeEventListener("mousedown", handleClickOutsideBranch);
  }, [branchOpenRef, branchDropdownRef]);

  const fetchBranches = async () => {
    try {
      const parts = repository.split("/");
      const owner = parts[0];
      const repoName = parts[1];
      const t = localStorage.getItem("token");
      const response = await fetch("http://localhost:3000/git-branches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${t}`
        },
        body: JSON.stringify({ userID, owner, repo: repoName })
      });
      if (!response.ok) throw new Error("Error fetching branches");
      const data = await response.json();
      setBranches(data);
      if (data.length > 0) {
        setSelectedBranch(data[0].name);
      }
    } catch (error) {
      console.error("Failed to fetch branches:", error);
    }
  };

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const parts = repository.split("/");
        const owner = parts[0];
        const repoName = parts[1];
        const t = localStorage.getItem("token");
        const response = await fetch("http://localhost:3000/git-branches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${t}`
          },
          body: JSON.stringify({ userID, owner, repo: repoName })
        });
        if (!response.ok) throw new Error("Error fetching branches");
        const data = await response.json();
        setBranches(data);
        if (data.length > 0) {
          setSelectedBranch(data[0].name);
        }
      } catch (error) {
        console.error("Failed to fetch branches:", error);
      }
    };
    if (!loading && token) {
      fetchBranches();
    }
  }, [loading, token, repository]);

  const handleContainerScroll = () => {
    setChangeTeamOpen(false);
    setBranchOpen(false);
  };

  const toggleChangeTeamDropdown = () => {
    setChangeTeamOpen(prev => !prev);
  };

  const toggleChangeEnvironmentPopout = () => {
    if (!changeEnvironmentOpen && envVars.length === 0) {
      setEnvVars([{ key: "", value: "" }]);
    }
    setChangeEnvironmentOpen(prev => !prev);
  };

  const toggleBranchDropdown = () => {
    setBranchOpen(prev => !prev);
  };

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const handleEnvVarChange = (index, field, newValue) => {
    setEnvVars(prevEnvVars => {
      const updated = [...prevEnvVars];
      updated[index][field] = newValue;
      return updated;
    });
  };

  const handleRemoveEnvVar = (index) => {
    setEnvVars(prevEnvVars => prevEnvVars.filter((_, i) => i !== index));
  };

  return (
    <div
      className="importProjectsPageWrapper"
      style={{
        background: "linear-gradient(to bottom, #322A54, #29282D)",
        display: screenSize >= 5300 ? "none" : ""
      }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && (
        <div className="importProjectsCellHeaderContainer" ref={scrollableContainerRef} onScroll={handleContainerScroll}>
          <div className="importProjectsFlexCell">
            <div className="importProjectsCellHeader">
              <a className="importProjectsImportingFromGithub">
                <span>
                  <p>Importing from GitHub</p>
                  <strong>
                    <FontAwesomeIcon icon={faGithub} />
                    {repository}
                  </strong>
                </span>
                <div className="importProjectsBranchSelector">
                  <button className="importProjectsBranchSelectorButton" ref={branchOpenRef} onClick={toggleBranchDropdown}>
                    <FontAwesomeIcon icon={faCodeBranch} />
                    <span className="importProjectsBranchSelectorButtonText">
                      {selectedBranch ? selectedBranch : "Select Branch"}
                    </span>
                  </button>
                </div>
              </a>
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapper">
                    <p>Stack Forge Team</p>
                    <button className="importProjectsOperationsField" ref={changeTeamOpenRef} onClick={toggleChangeTeamDropdown}>
                      <span>
                        <FontAwesomeIcon icon={faGithub} />
                        <p>{teamName}</p>
                      </span>
                      <FontAwesomeIcon
                        icon={faCaretDown}
                        className="importNewCaretIcon"
                        style={{
                          transform: changeTeamOpen ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.3s ease"
                        }}
                      />
                    </button>
                  </div>
                  <div className="importProjectsOperationsContainerWrapper">
                    <p>Project Name</p>
                    <input className="importProjectsOperationsField" />
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsDivider" />
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapperWide">
                    <p>Root Directory</p>
                    <div className="importProjectsOperationsField">
                      <p className="rootIcon">./</p>
                      <input type="text" className="rootInput" placeholder="Enter new root directory..." />
                      <FontAwesomeIcon icon={faCircleInfo} className="rootIconSupplement" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapperWide">
                    <p>Output Directory (optional)</p>
                    <div className="importProjectsOperationsField">
                      <p className="rootIcon">./</p>
                      <input type="text" className="rootInput" placeholder="Ex. 'public'" />
                      <FontAwesomeIcon icon={faCircleInfo} className="rootIconSupplement" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsDivider" />
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapperWide">
                    <p>Build Command (optional)</p>
                    <div className="importProjectsOperationsField">
                      <input type="text" className="rootInput" placeholder="Ex. 'npm run build'" />
                      <FontAwesomeIcon icon={faCircleInfo} className="rootIconSupplement" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapperWide">
                    <p>Install Command (optional)</p>
                    <div className="importProjectsOperationsField">
                      <input type="text" className="rootInput" placeholder="Ex. 'npm install'" />
                      <FontAwesomeIcon icon={faCircleInfo} className="rootIconSupplement" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsBar">
                <div className="importProjectsOperationsFlex">
                  <div className="importProjectsOperationsContainerWrapperWide">
                    <p>Environment Variables</p>
                    {changeEnvironmentOpen ? (
                      <div className="importProjectsOperationsStack">
                        <FontAwesomeIcon
                          icon={faXmark}
                          className="importProjectsClosePopout"
                          onClick={toggleChangeEnvironmentPopout}
                          style={{
                            transform: changeEnvironmentOpen ? "rotate(360deg)" : "rotate(270deg)",
                            transition: "transform 0.3s ease"
                          }}
                        />
                        <div className="importProjectsEnvVarsWrapper">
                          {envVars.map((envVar, index) => (
                            <div key={index} className="importProjectsEnvVarsRow">
                              <div className="importProjectsOperationsContainerWrapperShort">
                                <div className="importProjectsOperationsField" style={{ backgroundColor: "rgba(30, 30, 30, 0.4)" }}>
                                  <input
                                    type="text"
                                    className="rootInput"
                                    placeholder="Key"
                                    value={envVar.key}
                                    onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                                    style={{ color: "white" }}
                                  />
                                </div>
                              </div>
                              <div className="importProjectsOperationsContainerWrapperShort">
                                <div className="importProjectsOperationsField" style={{ backgroundColor: "rgba(30, 30, 30, 0.4)" }}>
                                  <input
                                    type="text"
                                    className="rootInput"
                                    placeholder="Value"
                                    value={envVar.value}
                                    onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                                    style={{ color: "white" }}
                                  />
                                </div>
                              </div>
                              <button className="importProjectsEnvVarsRemoveBtn" onClick={() => handleRemoveEnvVar(index)}>
                                -
                              </button>
                            </div>
                          ))}
                          <div className="importProjectsEnvVarsRow">
                            <button className="importProjectsEnvVarsAddBtn" onClick={handleAddEnvVar}>
                              Add More
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button className="importProjectsOperationsField" onClick={toggleChangeEnvironmentPopout} style={{ transition: "transform 0.3s ease" }}>
                        <span>
                          <p>Environment Variables</p>
                        </span>
                        <FontAwesomeIcon
                          icon={faCaretDown}
                          className="importNewCaretIcon"
                          style={{
                            transform: changeEnvironmentOpen ? "rotate(360deg)" : "rotate(270deg)",
                            transition: "transform 0.3s ease"
                          }}
                        />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="importProjectsOperationsBarSupplement">
                <button className="importProjectsDeployButton">Deploy New Project</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {!isLoaded && (
        <div className="importProjectsCellHeaderContainer" onScroll={handleContainerScroll} style={{ justifyContent: "center" }}>
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title">Stack Forge</label>
          </div>
        </div>
      )}
      {changeTeamOpen && (
        <div className="importProjectsOperationsDropdownMenu" ref={changeTeamDropdownRef} style={{ top: changeTeamDropdownPosition.top * 1.02, left: changeTeamDropdownPosition.left }}>
          <button onClick={() => navigate("/add-new-project")}>
            <span>
              <img src={teamImage} />
              <strong>
                {teamName}
                <br />
                <p>Team Project</p>
              </strong>
            </span>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
          <button onClick={() => navigate("/add-new-project")}>
            <span>
              <img src={personalImage} />
              <strong>
                {personalName}
                <br />
                <p>Team Project</p>
              </strong>
            </span>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
        </div>
      )}
      {branchOpen && (
        <div className="importProjectsBranchesDropdownMenu" ref={branchDropdownRef} style={{ top: branchDropdownPosition.top * 1.02, left: branchDropdownPosition.left }}>
          {branches.map(branch => (
            <button key={branch.name} onClick={() => { setSelectedBranch(branch.name); setBranchOpen(false); }}>
              <span>{branch.name}</span>
              {selectedBranch === branch.name && <FontAwesomeIcon icon={faCheckDouble} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StackForgeImportProject;
