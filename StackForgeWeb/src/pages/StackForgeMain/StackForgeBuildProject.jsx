import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCaretDown,
  faCodeBranch,
  faCheckDouble,
  faCircleInfo,
  faArrowUpRightFromSquare,
  faXmark,
  faClone,
  faSquareCheck,
  faGlobe
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeBuildProject.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav.jsx";
import useAuth from "../../UseAuth.jsx";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeBuildProject = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTouchDevice = useIsTouchDevice();
  const { token, userID, loading, organizationID } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [isDeploying, setIsDeploying] = useState(false);
  const [buildFinished, setBuildFinished] = useState(false);
  const [buildLogs, setBuildLogs] = useState([]);
  const [typedText, setTypedText] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollableContainerRef = useRef(null);
  const logsContainerRef = useRef(null);
  const typingIntervalRef = useRef(null);
  const repository = location.state?.repository;
  const personalName = location.state?.personalName;
  const personalImage = location.state?.personalImage;
  const teamName = location.state?.teamName;
  const teamImage = location.state?.teamImage;
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
  const [selectedTeamName, setSelectedTeamName] = useState(teamName);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [rootDirectory, setRootDirectory] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const buildLogsString = buildLogs.join("\n");
  const [successfulDeployment, setSuccessfulDeployment] = useState(false);

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        fetchBranches();
        setIsLoaded(true);
      } catch {}
    };
    if (!loading && token) fetchData();
  }, [userID, loading, token]);

  useEffect(() => {
    const handleResize = () => {
      setIsLoaded(false);
      setChangeTeamOpen(false);
      setBranchOpen(false);
      setScreenSize(window.innerWidth);
      setTimeout(() => setIsLoaded(true), 300);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = e => {
      if (
        changeTeamOpenRef.current &&
        !changeTeamOpenRef.current.contains(e.target) &&
        changeTeamDropdownRef.current &&
        !changeTeamDropdownRef.current.contains(e.target)
      )
        setChangeTeamOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (changeTeamOpen && changeTeamOpenRef.current && changeTeamDropdownRef.current) {
      const b = changeTeamOpenRef.current.getBoundingClientRect();
      const d = changeTeamDropdownRef.current.getBoundingClientRect();
      let top = b.bottom + 5;
      let left = b.right - d.width;
      if (top + d.height > window.innerHeight) top = window.innerHeight - d.height;
      if (left < 0) left = 0;
      setChangeTeamDropdownPosition({ top, left });
    }
  }, [changeTeamOpen]);

  useEffect(() => {
    const handleClickOutsideBranch = e => {
      if (
        branchOpenRef.current &&
        !branchOpenRef.current.contains(e.target) &&
        branchDropdownRef.current &&
        !branchDropdownRef.current.contains(e.target)
      )
        setBranchOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutsideBranch);
    return () => document.removeEventListener("mousedown", handleClickOutsideBranch);
  }, []);

  useEffect(() => {
    if (branchOpen && branchOpenRef.current && branchDropdownRef.current) {
      const b = branchOpenRef.current.getBoundingClientRect();
      const d = branchDropdownRef.current.getBoundingClientRect();
      let top = b.bottom + 5;
      let left = b.left;
      if (top + d.height > window.innerHeight) top = window.innerHeight - d.height;
      if (left + d.width > window.innerWidth) left = window.innerWidth - d.width;
      setBranchDropdownPosition({ top, left });
    }
  }, [branchOpen]);

  useEffect(() => {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    if (typedText.length >= buildLogsString.length) return;
    typingIntervalRef.current = setInterval(() => {
      setTypedText(prev => buildLogsString.slice(0, prev.length + 1));
    }, 5);
    return () => clearInterval(typingIntervalRef.current);
  }, [buildLogsString, typedText]);

  useEffect(() => {
    if (logsContainerRef.current) {
      const container = logsContainerRef.current;
      const bottomPadding = successfulDeployment ? 100 : 0;
      container.scrollTop = container.scrollHeight - bottomPadding;
    }
  }, [typedText, successfulDeployment]);

  useEffect(() => {
    if (buildFinished && typedText.length === buildLogsString.length) setIsDeploying(false);
  }, [buildFinished, typedText, buildLogsString]);

  useEffect(() => {
    if (buildFinished && typedText.length === buildLogsString.length && buildLogs.includes("Deployment successful!")) {
      setSuccessfulDeployment(true);
    }
  }, [buildFinished, typedText, buildLogsString, buildLogs]);

  const fetchBranches = async () => {
    try {
      const [owner, repoName] = repository.split("/");
      const t = localStorage.getItem("token");
      const r = await fetch("http://localhost:3000/git-branches", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ userID, owner, repo: repoName })
      });
      if (!r.ok) throw new Error("Error fetching branches");
      const data = await r.json();
      setBranches(data);
      if (data.length > 0) setSelectedBranch(data[0].name);
    } catch {}
  };

  const handleDeployProject = () => {
    setSuccessfulDeployment(false);
    setIsDeploying(true);
    setBuildFinished(false);
    setBuildLogs([]);
    setTypedText("");
    const params = new URLSearchParams({
      userID,
      organizationID,
      repository,
      branch: selectedBranch,
      teamName: selectedTeamName,
      projectName: selectedProjectName,
      rootDirectory,
      outputDirectory,
      buildCommand,
      installCommand,
      envVars: JSON.stringify(envVars),
      token: localStorage.getItem("token")
    });
    const sse = new EventSource(`http://localhost:3000/deploy-project-stream?${params.toString()}`);
    sse.onmessage = e => {
      const raw = e.data;
      if (raw === "__BUILD_COMPLETE__") {
        setBuildFinished(true);
        sse.close();
        setBuildLogs(p => [...p, "Deployment successful!"]);
        return;
      }
      if (raw.startsWith("__BUILD_ERROR__")) {
        setBuildFinished(true);
        sse.close();
        setBuildLogs(p => [...p, `ERROR: ${raw.replace("__BUILD_ERROR__", "")}`]);
        return;
      }
      const decoded = raw.replace(/\\r/g, "\r").replace(/\\n/g, "\n");
      decoded.split("\n").forEach(seg => {
        if (seg === "") return;
        if (seg.includes("\r")) {
          const last = seg.split("\r").pop();
          setBuildLogs(p => {
            if (p.length === 0) return [last];
            const c = [...p];
            c[c.length - 1] = last;
            return c;
          });
        } else setBuildLogs(p => [...p, seg]);
      });
    };
    sse.onerror = () => {
      setBuildFinished(true);
      sse.close();
      setBuildLogs(p => [...p, "ERROR: Connection lost during build."]);
    };
  };

  const handleCopyLogs = () => {
    navigator.clipboard
      .writeText(buildLogsString)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  };

  const handleContainerScroll = () => {
    setChangeTeamOpen(false);
    setBranchOpen(false);
  };

  const toggleChangeTeamDropdown = () => setChangeTeamOpen(p => !p);
  const toggleChangeEnvironmentPopout = () => {
    if (!changeEnvironmentOpen && envVars.length === 0) setEnvVars([{ key: "", value: "" }]);
    setChangeEnvironmentOpen(p => !p);
  };
  const toggleBranchDropdown = () => setBranchOpen(p => !p);

  const handleAddEnvVar = () => setEnvVars([...envVars, { key: "", value: "" }]);
  const handleEnvVarChange = (i, f, v) =>
    setEnvVars(prev => {
      const up = [...prev];
      up[i][f] = v;
      return up;
    });
  const handleRemoveEnvVar = i => setEnvVars(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div
      className="importProjectsPageWrapper"
      style={{ background: "linear-gradient(to bottom, #322A54, #29282D)", display: screenSize >= 5300 ? "none" : "" }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && (
        <div
          className="importProjectsCellHeaderContainer"
          ref={scrollableContainerRef}
          onScroll={handleContainerScroll}
          style={{ position: "relative" }}
        >
          <div className="buildProjectsFlexCellWrapper">
            <div className="buildProjectsFlexCellLeading" style={{ opacity: isDeploying ? 0.4 : 1 }}>
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
                        {selectedBranch || "Select Branch"}
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
                          style={{ transform: changeTeamOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }}
                        />
                      </button>
                    </div>
                    <div className="importProjectsOperationsContainerWrapper">
                      <p>Project Name</p>
                      <input className="importProjectsOperationsField" value={selectedProjectName} onChange={e => setSelectedProjectName(e.target.value)} />
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
                        <input
                          type="text"
                          className="rootInput"
                          placeholder="Enter new root directory..."
                          value={rootDirectory}
                          onChange={e => setRootDirectory(e.target.value)}
                        />
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
                        <input
                          type="text"
                          className="rootInput"
                          placeholder="Ex. 'public'"
                          value={outputDirectory}
                          onChange={e => setOutputDirectory(e.target.value)}
                        />
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
                        <input
                          type="text"
                          className="rootInput"
                          placeholder="Ex. 'npm run build'"
                          value={buildCommand}
                          onChange={e => setBuildCommand(e.target.value)}
                        />
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
                        <input
                          type="text"
                          className="rootInput"
                          placeholder="Ex. 'npm install'"
                          value={installCommand}
                          onChange={e => setInstallCommand(e.target.value)}
                        />
                        <FontAwesomeIcon icon={faCircleInfo} className="rootIconSupplement" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="importProjectsOperationsDivider" />
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
                            style={{ transform: changeEnvironmentOpen ? "rotate(360deg)" : "rotate(270deg)", transition: "transform 0.3s ease" }}
                          />
                          <div className="importProjectsEnvVarsWrapper">
                            {envVars.map((envVar, i) => (
                              <div key={i} className="importProjectsEnvVarsRow">
                                <div className="importProjectsOperationsContainerWrapperShort">
                                  <div className="importProjectsOperationsField" style={{ backgroundColor: "rgba(30, 30, 30, 0.4)" }}>
                                    <input
                                      type="text"
                                      className="rootInput"
                                      placeholder="Key"
                                      value={envVar.key}
                                      onChange={e => handleEnvVarChange(i, "key", e.target.value)}
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
                                      onChange={e => handleEnvVarChange(i, "value", e.target.value)}
                                      style={{ color: "white" }}
                                    />
                                  </div>
                                </div>
                                <button className="importProjectsEnvVarsRemoveBtn" onClick={() => handleRemoveEnvVar(i)}>
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
                        <button className="importProjectsOperationsField" onClick={toggleChangeEnvironmentPopout}>
                          <span>
                            <p>Environment Variables</p>
                          </span>
                          <FontAwesomeIcon
                            icon={faCaretDown}
                            className="importNewCaretIcon"
                            style={{ transform: changeEnvironmentOpen ? "rotate(360deg)" : "rotate(270deg)", transition: "transform 0.3s ease" }}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="importProjectsOperationsBarSupplement">
                  <button className="importProjectsDeployButton" onClick={handleDeployProject} disabled={isDeploying}>
                    Deploy New Project
                  </button>
                </div>
              </div>
            </div>

            <div className="buildProjectsFlexCellTrailing">
              <div className="consoleLogsHeader">
                <span>
                  <h3>Project Build Logs</h3>
                  <button onClick={handleCopyLogs}>
                    <FontAwesomeIcon icon={copied ? faSquareCheck : faClone} />
                  </button>
                </span>
                {isDeploying && <div className="loading-circle-supplement" />}
              </div>
              <div className={successfulDeployment ? "importProjectsBuildLogsCellLong" : "importProjectsBuildLogsCell"} ref={logsContainerRef}>
                {typedText === "" ? (
                  <div className="noBuildLogsDisplay">
                    <FontAwesomeIcon icon={faGlobe} />
                  </div>
                ) : (
                  typedText.split("\n").map((line, i) => {
                    if (line === "Deployment successful!") {
                      return (
                        <div className="importProjectsBuildLogsCellLogDisplay" key={i}>
                          <span className="log-content successLogLine">
                            Deployment successful!{" "}
                          </span>
                        </div>
                      );
                    }
                    const match = line.match(/^(\s*)(.*)$/);
                    const indent = match[1] || "";
                    const content = match[2] || "";
                    const cleanedContent = content.replace(/`+/g, "");

                    let logType = "";
                    if (content.startsWith("ERROR:")) logType = "errorLogLine";
                    else if (content.startsWith("WARNING:")) logType = "warningLogLine";
                    else if (content.startsWith("INFO:")) logType = "infoLogLine";
                    else if (content.startsWith("DEBUG:")) logType = "debugLogLine";

                    return (
                      <div className="importProjectsBuildLogsCellLogDisplay" key={i}>
                        {indent}
                        <span className={`log-content ${logType}`}>
                          {cleanedContent}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              {successfulDeployment && typedText.length === buildLogsString.length && (
                <div className="importProjectsOperationsBarSupplement">
                  <a
                    rel="noopener noreferrer"
                    href={`https://${selectedProjectName}.stackforgeengine.com`}
                    className="importProjectsDeployButton"
                  >
                    Go to project.
                  </a>
                </div>
              )}
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
          <button
            onClick={() => {
              setSelectedTeamName(teamName);
              setChangeTeamOpen(false);
            }}
          >
            <span>
              <img src={teamImage} alt="Team" />
              <strong>
                {teamName}
                <br />
                <p>Team Project</p>
              </strong>
            </span>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
          <button
            onClick={() => {
              setSelectedTeamName(personalName);
              setChangeTeamOpen(false);
            }}
          >
            <span>
              <img src={personalImage} alt="Personal" />
              <strong>
                {personalName}
                <br />
                <p>Personal Project</p>
              </strong>
            </span>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
        </div>
      )}
      {branchOpen && (
        <div className="importProjectsBranchesDropdownMenu" ref={branchDropdownRef} style={{ top: branchDropdownPosition.top * 1.02, left: branchDropdownPosition.left }}>
          {branches && branches.length > 0 ? (
            branches.map(b => (
              <button
                key={b.name}
                onClick={() => {
                  setSelectedBranch(b.name);
                  setBranchOpen(false);
                }}
              >
                <span>{b.name}</span>
                {selectedBranch === b.name && <FontAwesomeIcon icon={faCheckDouble} />}
              </button>
            ))
          ) : (
            <button>
              <span>No branches available.</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default StackForgeBuildProject;
