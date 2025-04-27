import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faList,
  faCaretDown,
  faCircleInfo,
  faGrip,
  faArrowUpRightFromSquare,
  faEllipsisH,
  faCodeBranch,
  faGlobe,
  faXmark,
  faFolderOpen
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav.jsx";
import { showDialog } from "../../helpers/StackForgeAlert.jsx";
import useAuth from "../../UseAuth.jsx";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProjects = () => {
  const navigate = useNavigate();
  const isTouchDevice = useIsTouchDevice();
  const { token, userID, loading, organizationID } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [resizeTrigger, setResizeTrigger] = useState(false);
  const [projects, setProjects] = useState([]);
  const [projectsPage, setProjectsPage] = useState("projects");
  const [displayMode, setDisplayMode] = useState("grid");
  const [searchText, setSearchText] = useState("");
  const addNewRef = useRef(null);
  const [addNewOpen, setAddNewOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [domainSearchModal, setDomainSearchModal] = useState(false);
  const [domainModalStep, setDomainModalStep] = useState(0);
  const [domainSearchTerm, setDomainSearchTerm] = useState("");
  const [selectedDomainProject, setSelectedDomainProject] = useState(null);
  const [domainName, setDomainName] = useState("");
  const [isAddingDomain, setIsAddingDomain] = useState(false);


  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        getProjects();
        setIsLoaded(true);
      } catch (error) { }
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
    const handleClickOutsideCellMenu = (event) => {
      if (openMenuId !== null && !event.target.closest('.threeDotMenuContainer')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutsideCellMenu);
    return () => document.removeEventListener("mousedown", handleClickOutsideCellMenu);
  }, [openMenuId]);

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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationID }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch (error) {
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
    setAddNewOpen(false);
  };

  const handleThreeDotClick = (e, projectId) => {
    e.stopPropagation();
    setOpenMenuId((prev) => (prev === projectId ? null : projectId));
  };

  const confirmDomainEntry = async () => {
    setIsAddingDomain(true);
    const token = localStorage.getItem("token");
  
    try {
      const response = await fetch("http://localhost:3000/validate-domain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userID,
          organizationID,
          projectID: selectedDomainProject.project_id,
          domain: domainName,
        }),
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      closeDomainSearchModal();
      const displayName =
        selectedDomainProject.project_name ?? selectedDomainProject.name;
      await showDialog({
        title: "Domain Added",
        message: `Project ${displayName} added with domain ${domainName}`,
        showCancel: false,
      });
  
      navigate("/project-settings", {
        state: { project: selectedDomainProject, settingsState: "domains" },
      });
    } catch (error) {
      closeDomainSearchModal();
      await showDialog({
        title: "Error",
        message: "Failed to add domain. Please try again.",
        showCancel: false,
      });
    } finally {
      setIsAddingDomain(false);
    }
  };
  

  const closeDomainSearchModal = () => {
    setDomainSearchModal(false);
    setDomainSearchTerm("");
    setSelectedDomainProject(null);
    setDomainName("");
    setDomainModalStep(0);
  };

  const confirmDomainSearch = () => {
    setDomainModalStep(1);
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
      className="projectsPageWrapper"
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
            <div
              className={`deploymentsContainer ${displayMode}`}
              style={{ opacity: addNewOpen ? "0.6" : "1.0" }}
            >
              {filteredProjects.map((project) => (
                <div
                  key={project.project_id}
                  className="deploymentCell"
                  onClick={() => {
                    navigate("/project-details", { state: { projectID: project.project_id, repository: project.repository } });
                  }}
                >
                  <div className="deploymentCellHeaderTop">
                    <div className="deploymentCellHeaderLeft">
                      <div className="deploymentCellHeaderLeftTop">
                        <img
                          src={project.image || "StackForgeLogo.png"}
                          className="deploymentCellProjectImage"
                        />
                        <div className="deploymentCellHeaderInfo">
                          <div className="deploymentCellHeaderProjectName">
                            {project.name || 'Unnamed Project'}
                          </div>
                          <div className="deploymentCellHeaderLink">
                            <a
                              href={project.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {project.url}
                            </a>
                          </div>
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
                        <button
                          className="threeDotMenuButton"
                          onClick={(e) => handleThreeDotClick(e, project.project_id)}
                        >
                          <FontAwesomeIcon icon={faEllipsisH} />
                        </button>
                        {openMenuId === project.project_id && (
                          <div className="threeDotDropdownMenu">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(project.url, "_blank");
                              }}
                            >
                              Visit Website
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("/project-details", { state: { projectID: project.project_id, repository: project.repository } });
                              }}
                            >
                              View Project Details
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("/project-settings", { state: { project } });
                              }}
                            >
                              Settings
                            </button>
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

          {projectsPage === "domains" && (
            <div className="addDomainsFlexCellWrapper">
              <div className="addDomainsFlexCell">
                <div className="addDomainsStack">
                  <div className="addDomainsIcon">
                    <FontAwesomeIcon icon={faGlobe} />
                  </div>
                  <strong>Add a new subdomain.</strong>
                  <p>Add a new subdomain for one of your projects.</p>
                </div>
                <button className="addDomainButton" onClick={() => setDomainSearchModal(true)}>
                  Add existing domain.
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {!isLoaded && (
        <div
          className="projectsCellHeaderContainer"
          style={{ justifyContent: "center", alignItems: "center", height: "100%" }}
        >
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title">Stack Forge</label>
          </div>
        </div>
      )}
      {addNewOpen && (
        <div
          className="dropdownMenu"
          ref={dropdownRef}
          style={{ top: dropdownPosition.top * 1.02, left: dropdownPosition.left }}
        >
          <button onClick={() => navigate("/add-new-project")}>
            <i>Project</i>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
          <button onClick={() => { setProjectsPage("domains"); setAddNewOpen(false); }}>
            <i>Domain</i>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
          <button onClick={() => handleAddNewItem("Team Member")}>
            <i>Team Member</i>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
        </div>
      )}
      {domainSearchModal && domainModalStep === 0 && (
        <div className="domainSearchModalOverlay">
          <div className="domainSearchModalContainer">
            <div className="domainSearchModalHeader">
              <h2>Add Domain</h2>
              <button onClick={closeDomainSearchModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="domainSearchModalBody">
              <p>Select a project to add your domain to:</p>
              <div className="domainSearchDeploymentList">
                <div className="domainSearchInputWrapper">
                  <FontAwesomeIcon icon={faSearch} className="domainSearchIcon" />
                  <input
                    type="text"
                    className="domainSearchInput"
                    placeholder="Search your projects..."
                    value={domainSearchTerm}
                    onChange={(e) => setDomainSearchTerm(e.target.value)}
                  />
                  <FontAwesomeIcon icon={faCircleInfo} className="domainSearchIconSupplement" />
                </div>
                {projects
                  .filter((project) => {
                    const name = project.project_name ?? project.name;
                    return name.toLowerCase().includes(domainSearchTerm.toLowerCase());
                  })
                  .map((project) => {
                    const name = project.project_name ?? project.name;
                    return (
                      <div key={project.project_id} className="domainSearchDeploymentItem">
                        <span>
                          <FontAwesomeIcon icon={faFolderOpen} />
                          {name}
                        </span>
                        <button
                          onClick={() => setSelectedDomainProject(project)}
                          style={
                            selectedDomainProject?.project_id === project.project_id
                              ? { backgroundColor: "#5c2be2", color: "#f1f1f1" }
                              : {}
                          }
                        >
                          Select
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
            <div className="domainSearchModalFooter">
              <button onClick={closeDomainSearchModal}>Cancel</button>
              <button
                disabled={!selectedDomainProject}
                onClick={confirmDomainSearch}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

    {domainSearchModal && domainModalStep === 1 && (
      <div className="domainSearchModalOverlay">
        <div
          className="domainSearchModalContainer"
          style={{ position: "relative" }}
        >
          {isAddingDomain && (
              <div
              className="loading-wrapper"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.5)",
                zIndex: 10,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div className="loading-circle" />
            </div>
          )}

          <div className="domainSearchModalHeader">
            <h2>Enter Domain</h2>
            <button onClick={closeDomainSearchModal}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
          <div className="domainSearchModalBody">
            <p>
              Project:{" "}
              <strong>
                {selectedDomainProject.project_name ??
                  selectedDomainProject.name}
              </strong>
            </p>
            <p>Enter the domain that you would like to add: </p>
            <div className="domainSearchDeploymentContent">
              <div className="domainSearchInputWrapperRounded">
                <FontAwesomeIcon icon={faGlobe} className="domainSearchIcon" />
                <input
                  type="text"
                  className="domainSearchInput"
                  placeholder="example.com"
                  value={domainName}
                  onChange={(e) => setDomainName(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="domainSearchModalFooter">
            <button onClick={closeDomainSearchModal}>Cancel</button>
            <button disabled={!domainName} onClick={confirmDomainEntry}>
              Add Domain
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default StackForgeProjects;
