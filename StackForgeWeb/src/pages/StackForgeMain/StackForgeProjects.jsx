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
  faFolderOpen,
  faListUl,
  faArrowsRotate,
  faArrowLeft,
  faArrowRight,
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav.jsx";
import { showDialog } from "../../helpers/StackForgeAlert.jsx";
import useAuth from "../../UseAuth.jsx";
import useIsTouchDevice from "../../TouchDevice.jsx";
import BarChart from "../../helpers/PlottingHelpers/BarHelper.jsx";
import LineChart from "../../helpers/PlottingHelpers/LineHelper.jsx";

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
  const [activities, setActivities] = useState([]);
  const [activityPage, setActivityPage] = useState(0);
  const [activityLimit] = useState(10);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [activitySearchText, setActivitySearchText] = useState("");
  const debounceTimeoutRef = useRef(null);
  const [monitoringData, setMonitoringData] = useState([]);
  const [individualMetrics, setIndividualMetrics] = useState({
    pageViews: [],
    uniqueVisitors: [],
    bounceRate: [],
    edgeRequests: [],
  });
  const [visibleSeries, setVisibleSeries] = useState({
    pageViews: true,
    visitors: true,
    bounceRate: true,
    edgeRequests: true,
  });
  const [isLoadingMonitoring, setIsLoadingMonitoring] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [allSubdomains, setAllSubdomains] = useState([]); 
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
  });
  const [domainDropdownOpen, setDomainDropdownOpen] = useState(false);
  const domainSelectRef = useRef(null);
  const domainDropdownRef = useRef(null);
  const [domainDropdownPosition, setDomainDropdownPosition] = useState({ top: 0, left: 0 });

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
      setDomainDropdownOpen(false);
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
      if (
        domainSelectRef.current &&
        !domainSelectRef.current.contains(event.target) &&
        domainDropdownRef.current &&
        !domainDropdownRef.current.contains(event.target)
      ) {
        setDomainDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [addNewRef, dropdownRef, domainSelectRef, domainDropdownRef]);

  useEffect(() => {
    const handleClickOutsideCellMenu = (event) => {
      if (openMenuId !== null && !event.target.closest(".threeDotMenuContainer")) {
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

  useEffect(() => {
    if (domainDropdownOpen && domainSelectRef.current && domainDropdownRef.current) {
      const buttonRect = domainSelectRef.current.getBoundingClientRect();
      const dropdownRect = domainDropdownRef.current.getBoundingClientRect();
      let newTop = buttonRect.bottom + 5;
      let newLeft = buttonRect.right - dropdownRect.width;
      if (newTop + dropdownRect.height > window.innerHeight) {
        newTop = window.innerHeight - dropdownRect.height;
      }
      if (newLeft < 0) {
        newLeft = 0;
      }
      setDomainDropdownPosition({ top: newTop * 1.02, left: newLeft });
    }
  }, [domainDropdownOpen]);

  useEffect(() => {
    const fetchActivityLogs = async () => {
      if (projectsPage !== "activity" || !token) return;
      try {
        const response = await fetch("http://localhost:3000/get-activity-data", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            userID,
            organizationID,
            limit: activityLimit,
            offset: activityPage * activityLimit,
            search: activitySearchText,
          }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setActivities(data.data || []);
      } catch (error) {
        setActivities([]);
        await showDialog({
          title: "Error",
          message: "Failed to load activity logs. Please try again.",
          showCancel: false,
        });
      } finally {
        setIsLoadingActivities(false);
      }
    };
    fetchActivityLogs();
  }, [projectsPage, token, userID, organizationID, activityPage, activityLimit, activitySearchText]);

  useEffect(() => {
    const fetchMonitoringData = async () => {
      if (!["monitoring", "usage"].includes(projectsPage) || !token) return;
      setIsLoadingMonitoring(true);
      try {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(currentWeekStart.getDate() + 6);
        const response = await fetch("http://localhost:3000/get-aggregate-metrics", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            organizationID,
            domain: selectedDomain || "all_domains",
            startDate: currentWeekStart.toISOString().split("T")[0],
            endDate: weekEnd.toISOString().split("T")[0],
            groupBy: "day",
          }),
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setMonitoringData(data.data || []);
  
        const transformMetrics = (metrics) => {
          return metrics.map((item) => {
            if (!item.date || typeof item.date !== "string") {
              return { date: "Invalid Date", value: item.value || 0 };
            }
  
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(item.date)) {
              return { date: "Invalid Date", value: item.value || 0 };
            }
  
            const testDate = new Date(item.date);
            if (isNaN(testDate.getTime())) {
              return { date: "Invalid Date", value: item.value || 0 };
            }
  
            return {
              date: item.date,
              value: item.value,
            };
          });
        };
  
        const transformedMetrics = {
          pageViews: data.individualMetrics?.pageViews
            ? transformMetrics(data.individualMetrics.pageViews)
            : [],
          uniqueVisitors: data.individualMetrics?.uniqueVisitors
            ? transformMetrics(data.individualMetrics.uniqueVisitors)
            : [],
          bounceRate: data.individualMetrics?.bounceRate
            ? transformMetrics(data.individualMetrics.bounceRate)
            : [],
          edgeRequests: data.individualMetrics?.edgeRequests
            ? transformMetrics(data.individualMetrics.edgeRequests)
            : [],
        };
  
        setIndividualMetrics(transformedMetrics);
      } catch (error) {
        setMonitoringData([]);
        setIndividualMetrics({
          pageViews: [],
          uniqueVisitors: [],
          bounceRate: [],
          edgeRequests: [],
        });
      } finally {
        setIsLoadingMonitoring(false);
      }
    };
    fetchMonitoringData();
  }, [projectsPage, token, organizationID, selectedDomain, currentWeekStart]);

  useEffect(() => {
    const fetchAllSubdomains = async () => {
      const subs = new Set();
      for (const proj of projects) {
        try {
          const res = await fetch("http://localhost:3000/project-domains", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              userID,
              organizationID,
              projectID: proj.project_id,
            }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          data.domains.forEach((d) => {
            subs.add(`${d.domainName}.stackforgeengine.com`);
          });
        } catch {}
      }
      setAllSubdomains(Array.from(subs));
    };
    if (projectsPage === "monitoring" && token && projects.length > 0) {
      fetchAllSubdomains();
    }
  }, [projectsPage, projects, token, userID, organizationID]);

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

  const handleActivitySearchChange = (e) => {
    const searchValue = e.target.value;
    setActivitySearchText(searchValue);
    setIsLoadingActivities(true);
    setActivityPage(0);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {}, 300);
  };

  const refreshActivityLogs = async () => {
    if (!token || isLoadingActivities) return;
    setIsLoadingActivities(true);
    try {
      const response = await fetch("http://localhost:3000/get-activity-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userID,
          organizationID,
          limit: activityLimit,
          offset: activityPage * activityLimit,
          search: activitySearchText,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setActivities(data.data || []);
    } catch (error) {
      setActivities([]);
      await showDialog({
        title: "Error",
        message: "Failed to refresh activity logs. Please try again.",
        showCancel: false,
      });
    } finally {
      setIsLoadingActivities(false);
    }
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

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        closeDomainSearchModal();
        if (response.status === 429 && data?.code === "DOMAIN_THROTTLED") {
          await showDialog({
            title: "Please Wait",
            message: data.message || "You must wait before adding a new domain.",
            showCancel: false,
          });
        } else {
          await showDialog({
            title: "Error",
            message: "Failed to add domain. Please try again.",
            showCancel: false,
          });
        }
        return;
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

  const filteredActivities = activities.filter((activity) =>
    activity.description.toLowerCase().includes(activitySearchText.toLowerCase())
  );

  const getUniqueDomains = () => {
    const domains = projects
      .map((project) => project.url)
      .filter((url) => url)
      .map((url) => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })
      .filter((domain) => domain);
    return [...new Set(domains)];
  };

  const handlePreviousWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(currentWeekStart.getDate() - 7);
    setCurrentWeekStart(newStart);
  };

  const handleNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(currentWeekStart.getDate() + 7);
    const today = new Date();
    const currentWeekMonday = new Date(today);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    currentWeekMonday.setDate(today.getDate() - daysToMonday);
    currentWeekMonday.setHours(0, 0, 0, 0);
    if (newStart <= currentWeekMonday) {
      setCurrentWeekStart(newStart);
    }
  };

  const handleDomainSelect = (domain) => {
    setSelectedDomain(domain);
    setDomainDropdownOpen(false);
  };

  const toggleDomainDropdown = () => {
    setDomainDropdownOpen((prev) => !prev);
  };

  const toggleSeries = (series) => {
    setVisibleSeries((prev) => {
      const newState = { ...prev, [series]: !prev[series] };
      const visibleCount = Object.values(newState).filter(Boolean).length;
      if (visibleCount === 0) {
        return prev;
      }
      return newState;
    });
  };

  const formatWeekDisplay = () => {
    const start = currentWeekStart;
    const end = new Date(currentWeekStart);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  };


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
            <>
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
            </>
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

          {projectsPage === "activity" && (
            <>
              <div className="projectsTopBar">
                <div className="projectsTopBarControls"> 
                    <FontAwesomeIcon icon={faListUl}/>
                    <p> 
                      Your Activity Logs
                    </p>
                </div>
                <div className="projectsTopBarSearchContainer">
                  <div className="searchBarWrapper">
                    <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                    <input
                      type="text"
                      className="searchInput"
                      placeholder="Search Logs..."
                      value={activitySearchText}
                      onChange={handleActivitySearchChange}
                    />
                    <FontAwesomeIcon icon={faCircleInfo} className="searchIconSupplement" />
                  </div>

                  <button
                    onClick={refreshActivityLogs}
                    disabled={isLoadingActivities}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate}/>
                  </button>
                </div>
              </div>

              <div className="activityLogsFlexWrapper">
                {isLoadingActivities ? (
                  <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <div className="loading-circle" />
                  </div>
                ) : filteredActivities.length === 0 ? (
                  <div className="activityLogsNoResults">
                    <div className="activityLogsNoResultCell">
                      <FontAwesomeIcon
                        icon={faListUl}
                        size="3x"
                        className="activityLogsNoResultsIcon"
                      />
                      <div className="activityLogsNoResultsText">
                        No logs found for the selected filters. 
                      </div>
                      <div className="activityLogsNoResultsButtons">
                        <button
                          className="activityLogsNoResultsRefresh"
                          onClick={refreshActivityLogs}
                          disabled={isLoadingActivities}
                        >
                          Refresh Logs
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {filteredActivities.map((activity, index) => (
                      <div
                        className="activityLogItemWrapper"
                        key={index}
                      >
                        <img
                          className="activityLogItemWrapperImage "
                          src={activity.userImage || "StackForgeLogo.png"}
                          alt=""
                        />
                        <div className="activitylogItemWrapperTitleStack">
                          <strong>
                            {activity.description}
                          </strong>
                          <p style={{ color: '#aaaaaa', fontSize: '0.9em', margin: '5px 0 0 0' }}>
                            {new Date(activity.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {projectsPage === "monitoring" && (
            <div className="monitoringAnalyticsFlexWrapper">
              <div className="monitoringAnalyticsFlexCell">
                <div className="monitoringAnalyticsFlexWrapperTopBar">
                  <div
                    className="monitoringAnalyticsFlexWrapperTopBarItem"
                    onClick={() => toggleSeries("pageViews")}
                    style={{
                      cursor: "pointer",
                      backgroundColor: visibleSeries.pageViews ? "rgba(84, 112, 198, 0.2)" : "transparent",
                    }}
                  >
                    <h3>Page Views</h3>
                    <p>
                      {monitoringData.length > 0 ? monitoringData.reduce((sum, item) => sum + item.pageviews, 0) : 0}
                    </p>
                  </div>
                  <div
                    className="monitoringAnalyticsFlexWrapperTopBarItem"
                    onClick={() => toggleSeries("visitors")}
                    style={{
                      cursor: "pointer",
                      backgroundColor: visibleSeries.visitors ? "rgba(86, 222, 163, 0.2)" : "transparent",
                    }}
                  >
                    <h3>Visitors</h3>
                    <p>
                      {monitoringData.length > 0 ? monitoringData.reduce((sum, item) => sum + item.uniqueVisitors, 0) : 0}
                    </p>
                  </div>
                  <div
                    className="monitoringAnalyticsFlexWrapperTopBarItem"
                    onClick={() => toggleSeries("bounceRate")}
                    style={{
                      cursor: "pointer",
                      backgroundColor: visibleSeries.bounceRate ? "rgba(155, 89, 182, 0.2)" : "transparent",
                    }}
                  >
                    <h3>Bounce Rate</h3>
                    <p>
                      {monitoringData.length > 0
                        ? `${(monitoringData.reduce((sum, item) => sum + item.bounceRate, 0) / monitoringData.length * 100).toFixed(1)}%`
                        : '0%'}
                    </p>
                  </div>
                  <div
                    className="monitoringAnalyticsFlexWrapperTopBarItem"
                    onClick={() => toggleSeries("edgeRequests")}
                    style={{
                      cursor: "pointer",
                      backgroundColor: visibleSeries.edgeRequests ? "rgba(138, 86, 222, 0.2)" : "transparent",
                    }}
                  >
                    <h3>Edge Requests</h3>
                    <p>
                      {monitoringData.length > 0 ? monitoringData.reduce((sum, item) => sum + item.edgeRequests, 0) : 0}
                    </p>
                  </div>
                </div>

                <div className="monitoringAnalyticsFlexWrapperTopBarSupplement">
                  <div className="selectDomainsMonitoringFlex">
                    <label> 
                      Select a Domain
                    </label>

                    <div className="selectDomainsMonitoringWrapper" ref={domainSelectRef}>
                      <button className="addDomainMonitoringButton" onClick={toggleDomainDropdown}>
                        <p>{selectedDomain || "All Domains"}</p>
                        <FontAwesomeIcon
                          icon={faCaretDown}
                          className="addDomainMonitoringCaretIcon"
                          style={{
                            transform: domainDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.3s ease"
                          }}
                        />
                      </button>
                    </div>
                    {domainDropdownOpen && (
                      <div
                        className="addDomainMonitoringCaretIconDropdownMenu"
                        ref={domainDropdownRef}
                        style={{
                          top: domainDropdownPosition.top,
                          left: domainDropdownPosition.left,
                          zIndex: 1000
                        }}
                      >
                        <button onClick={() => handleDomainSelect("")}>
                          <i>All Domains</i>
                        </button>
                        {allSubdomains.map((domain, index) => (
                          <button
                            key={index}
                            onClick={() => handleDomainSelect(domain)}
                          >
                            <i>{domain}</i>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="monitoringDateEntry">
                    <label> 
                      Select a Data Period
                    </label>

                    <div className="monitoringDateEntryDateFlex"> 
                      <button
                        onClick={handlePreviousWeek}
                      >
                        <FontAwesomeIcon icon={faArrowLeft} />
                      </button>
                      <span>{formatWeekDisplay()}</span>
                      <button
                        onClick={handleNextWeek}
                        disabled={(() => {
                          const today = new Date();
                          const currentWeekMonday = new Date(today);
                          const dayOfWeek = today.getDay();
                          const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                          currentWeekMonday.setDate(today.getDate() - daysToMonday);
                          currentWeekMonday.setHours(0, 0, 0, 0);
                          return currentWeekStart.getTime() >= currentWeekMonday.getTime();
                        })()}
                      >
                        <FontAwesomeIcon icon={faArrowRight} />
                      </button>
                    </div>
                  </div>
                </div>

                {isLoadingMonitoring ? (
                  <div className="monitoringAnalyticsFlexWrapperBarPlot">
                    <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                      <div className="loading-circle" />
                    </div>
                  </div>
                ) : (
                  <div className="monitoringAnalyticsFlexWrapperBarPlot">
                    <BarChart
                      data={monitoringData}
                      startDate={currentWeekStart}
                      endDate={(() => {
                        const end = new Date(currentWeekStart);
                        end.setDate(currentWeekStart.getDate() + 6);
                        return end;
                      })()}
                      visibleSeries={visibleSeries}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {projectsPage === "usage" && (
            <div className="usageAnalyticsFlexWrapper">
              <div className="usageAnalyticsFlexCellWrapper"> 
                <div className="usageAnalyticsFlexCell"> 
                 
                  {isLoadingMonitoring ? (
                    <div className="loading-wrapper">
                      <div className="loading-circle" />
                    </div>
                  ) : (
                    <>
                      <span>
                        <label> 
                          Page Visits
                        </label>
                        <p> 
                          Last 7 Days
                        </p>
                      </span>

                      <LineChart
                        data={individualMetrics.pageViews}
                        color="rgba(84, 112, 198, 0.6)"
                      />
                    </>
                  )}
                </div>

                <div className="usageAnalyticsFlexCell"> 
                  {isLoadingMonitoring ? (
                    <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                      <div className="loading-circle" />
                    </div>
                  ) : (
                    <>
                      <span>
                        <label> 
                          Unique Visitors
                        </label>
                        <p> 
                          Last 7 Days
                        </p>
                      </span>
                      <LineChart
                        data={individualMetrics.uniqueVisitors}
                        color="rgba(86, 222, 163, 0.6)"
                      />
                    </>
                  )}
                </div>
              </div>

              <div className="usageAnalyticsFlexCellWrapper"> 
                <div className="usageAnalyticsFlexCell"> 
                  {isLoadingMonitoring ? (
                    <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                      <div className="loading-circle" />
                    </div>
                  ) : (
                    <>
                      <span>
                        <label> 
                          Bounce Rate
                        </label>
                        <p> 
                          Last 7 Days
                        </p>
                      </span>
                      <LineChart
                        data={individualMetrics.bounceRate}
                        color="rgba(155, 89, 182, 0.6)"
                        yAxisFormatter={(value) => `${(value * 100).toFixed(1)}%`}
                      />
                    </>
                  )}
                </div>
                <div className="usageAnalyticsFlexCell"> 
                  
                  {isLoadingMonitoring ? (
                    <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                      <div className="loading-circle" />
                    </div>
                  ) : (
                    <>
                      <span>
                        <label> 
                          Edge Requests
                        </label>
                        <p> 
                          Last 7 Days
                        </p>
                      </span>
                      <LineChart
                        data={individualMetrics.edgeRequests}
                        color="rgba(138, 86, 222, 0.8)"
                      />
                    </>
                  )}
                </div>
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
              <h3>Add Domain</h3>
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
              <h3>Enter Domain</h3>
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
