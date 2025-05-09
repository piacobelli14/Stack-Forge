import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFile,
  faFolder,
  faFolderOpen,
  faPlusSquare,
  faMinusSquare,
  faMagnifyingGlass,
  faClone,
  faCheckSquare,
  faSquareCheck,
  faCodeBranch,
  faXmark,
  faGlobe,
  faKey
} from "@fortawesome/free-solid-svg-icons";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeUpdateDetails.css";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeBuildProject.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import "../../styles/helperStyles/Checkbox.css";

const StackForgeUpdateDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, userID, organizationID, loading } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);

  const {
    commitDetails,
    repository,
    owner,
    branchName,
    projectID,
    projectName
  } = location.state || {};
  const [commitData, setCommitData] = useState(null);
  const [commitStatus, setCommitStatus] = useState(null);
  const [fileFilter, setFileFilter] = useState("");
  const [openDirs, setOpenDirs] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const filteredFiles = commitData?.files?.filter((f) => f.filename.toLowerCase().includes(fileFilter.toLowerCase())) || [];
  const directoryTree = filteredFiles.length > 0 ? buildDirectoryTree(filteredFiles) : null;
  const commitSha = commitData?.sha || "";
  const commitUrl = commitData?.html_url || "";
  const parentCount = commitData?.parents?.length || 0;
  const parentSha = commitData?.parents?.[0]?.sha || "";
  const parentUrl = commitData?.parents?.[0]?.html_url || "";
  const branch = branchName || "";
  const totalFilesChanged = commitData?.files?.length || 0;
  const totalAdditions = commitData?.stats?.additions || 0;
  const totalDeletions = commitData?.stats?.deletions || 0;
  const [copyStatus, setCopyStatus] = useState({});
  const [copied, setCopied] = useState(false);
  const [isProjectUpdate, setIsProjectUpdate] = useState(false);
  const [successfulDeployment, setSuccessfulDeployment] = useState(false);
  const [deployedSubdomains, setDeployedSubdomains] = useState([]);
  const [domains, setDomains] = useState([]);
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [modalStep, setModalStep] = useState(0);
  const [fetchedBuildParams, setFetchedBuildParams] = useState({
    root_directory: "",
    output_directory: "",
    build_command: "",
    install_command: ""
  });
  const [rootDirectory, setRootDirectory] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [changeEnvironmentOpen, setChangeEnvironmentOpen] = useState(false);
  const [envVars, setEnvVars] = useState([]);
  const [buildLogs, setBuildLogs] = useState([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const buildLogsString = buildLogs.join("\n");
  const [typedText, setTypedText] = useState("");
  const typingIntervalRef = useRef(null);
  const logsContainerRef = useRef(null);
  const successLoggedRef = useRef(false);

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      await fetchCommitDetails();
      await fetchPreviousBuildParams();
      await checkCommitRelativeToDeployment();
      await fetchDomains();
      setIsLoaded(true);
    };
    if (!loading && token) fetchData();
  }, [userID, loading, token]);

  useEffect(() => {
    const resize = () => {
      setIsLoaded(false);
      setScreenSize(window.innerWidth);
      setTimeout(() => setIsLoaded(true), 300);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const normalize = (v) => (v === "." || v === "./" ? "" : v);
    setRootDirectory(normalize(fetchedBuildParams.root_directory) || "");
    setOutputDirectory(normalize(fetchedBuildParams.output_directory) || "");
    setBuildCommand(fetchedBuildParams.build_command || "");
    setInstallCommand(fetchedBuildParams.install_command || "");
  }, [fetchedBuildParams]);

  useEffect(() => {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    if (typedText.length >= buildLogsString.length) return;
    typingIntervalRef.current = setInterval(() => {
      setTypedText((prev) => buildLogsString.slice(0, prev.length + 1));
    }, 5);
    return () => clearInterval(typingIntervalRef.current);
  }, [buildLogsString, typedText]);

  useEffect(() => {
    if (logsContainerRef.current)
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [typedText]);

  useEffect(() => {
    if (successfulDeployment) return;
    const ok = buildLogs.find((l) =>
      l.startsWith("Update completed successfully for subdomains:")
    );
    if (ok && typedText.length === buildLogsString.length) {
      const names =
        ok
          .split(":")[1]
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) || [];
      setSuccessfulDeployment(true);
      setDeployedSubdomains(names);
    }
  }, [buildLogs, typedText, buildLogsString, successfulDeployment]);

  useEffect(() => {
    const normalize = (v) => (v === "." || v === "./" ? "" : v);
    setRootDirectory(normalize(fetchedBuildParams.root_directory || ""));
    setOutputDirectory(normalize(fetchedBuildParams.output_directory || ""));
    setBuildCommand(fetchedBuildParams.build_command || "");
    setInstallCommand(fetchedBuildParams.install_command || "");
  }, [fetchedBuildParams]);

  const fetchCommitDetails = async () => {
    try {
      const r = await fetch("http://localhost:3000/git-commit-details", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userID, owner, repo: repository, commitSha: commitDetails?.sha })
      });
      if (!r.ok) throw new Error("Failed to fetch commit details");
      setCommitData(await r.json());
    } catch (e) { }
  };

  const fetchPreviousBuildParams = async () => {
    try {
      const r = await fetch("http://localhost:3000/fetch-current-build-info", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userID, organizationID, projectID })
      });
      if (!r.ok) throw new Error("Failed to fetch build parameters");
      const d = await r.json();
      setFetchedBuildParams({
        root_directory: d.root_directory || "",
        output_directory: d.output_directory || "",
        build_command: d.build_command || "",
        install_command: d.install_command || ""
      });
      setEnvVars(d.env_vars || []);
      if ((d.env_vars || []).length > 0) setChangeEnvironmentOpen(true);
    } catch (e) { }
  };

  const fetchDomains = async () => {
    try {
      const r = await fetch("http://localhost:3000/project-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userID, organizationID, projectID })
      });
      if (!r.ok) throw new Error(`Failed to fetch domains: ${r.status}`);
      const d = await r.json();
      setDomains(
        d.domains.map((dom) => ({
          ...dom,
          environment: dom.environment
            ? dom.environment.charAt(0).toUpperCase() +
            dom.environment.slice(1).toLowerCase()
            : dom.environment
        })) || []
      );
    } catch (e) { }
  };

  const checkCommitRelativeToDeployment = async () => {
    try {
      const r = await fetch("http://localhost:3000/git-repo-update-details-relative-to-deployment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userID,
          organizationID,
          projectID,
          owner,
          repo: repository,
          commitSha: commitDetails?.sha
        })
      });
      if (!r.ok) throw new Error("Failed to check commit");
      setCommitStatus(await r.json());
    } catch (e) { }
  };

  const handleConfirm = async () => {
    try {
      if (selectedDomains.length === 0) {
        setBuildLogs((p) => [...p, "ERROR: Please select at least one domain to update."]);
        return;
      }
      if (!projectID) {
        setBuildLogs((p) => [...p, "ERROR: Project ID is missing."]);
        return;
      }
      if (!repository) {
        setBuildLogs((p) => [...p, "ERROR: Repository is missing."]);
        return;
      }

      const subs = domains
        .filter((d) => selectedDomains.includes(d.domainID))
        .map((d) => {
          const m = d.domainName.match(/^(.+)\.stackforgeengine\.com$/);
          return m ? m[1] : d.domainName;
        })
        .filter(Boolean);

      if (subs.length === 0) {
        setBuildLogs((p) => [...p, "ERROR: No valid subdomains selected."]);
        return;
      }

      setBuildLogs([]);
      setTypedText("");
      successLoggedRef.current = false;
      setIsBuilding(true);
      setSuccessfulDeployment(false);
      setDeployedSubdomains([]);
      setModalStep(5);

      const payload = {
        userID,
        organizationID,
        projectName,
        projectID,
        subdomains: subs,
        repository,
        branch: branchName,
        rootDirectory: rootDirectory === "." || rootDirectory === "./" ? "" : rootDirectory || "",
        outputDirectory: outputDirectory === "." || outputDirectory === "./" ? "" : outputDirectory || "",
        buildCommand: buildCommand || "",
        installCommand: installCommand || "",
        envVars: envVars.filter((e) => e.key && e.value),
        template: "default",
        teamName: ""
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        setIsBuilding(false);
        setBuildLogs((p) => [...p, "ERROR: Request timed out after 30 minutes."]);
      }, 30 * 60 * 1000);

      const r = await fetch("http://localhost:3000/update-project-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);

      const reader = r.body.getReader();
      let buf = "";
      const successMessage = `Update completed successfully for subdomains: ${subs.join(", ")}`;

      const addSuccess = () => {
        if (successLoggedRef.current) return;
        setBuildLogs((p) => [...p, successMessage]);
        successLoggedRef.current = true;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += new TextDecoder().decode(value);
        const lines = buf.split("\n");
        buf = lines.pop();

        lines.forEach((ln) => {
          const line = ln.trim();
          if (!line || line.startsWith(":")) return;

          if (line.startsWith("Update completed successfully")) {
            addSuccess();
            return;
          }

          try {
            JSON.parse(line);
            addSuccess();
            setIsBuilding(false);
          } catch {
            setBuildLogs((p) => [...p, line]);
          }
        });
      }

      if (buf.trim()) {
        try {
          JSON.parse(buf.trim());
          addSuccess();
        } catch {
          if (buf.trim().startsWith("Update completed successfully")) addSuccess();
          else setBuildLogs((p) => [...p, buf.trim()]);
        }
      }
      setIsBuilding(false);
    } catch (err) {
      setIsBuilding(false);
      setBuildLogs((p) => [...p, `ERROR: Build failed: ${err.message}`]);
    }
  };

  const handleCopy = (t) => {
    navigator.clipboard.writeText(t);
    setCopyStatus((p) => ({ ...p, [t]: true }));
    setTimeout(() => setCopyStatus((p) => ({ ...p, [t]: false })), 2000);
  };

  const handleCopyLogs = () => {
    if (!buildLogsString) return;
    navigator.clipboard.writeText(buildLogsString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAddEnvVar = () => setEnvVars((p) => [...p, { key: "", value: "" }]);

  const handleEnvVarChange = (i, f, v) =>
    setEnvVars((p) => {
      const up = [...p];
      up[i][f] = v;
      return up;
    });

  const handleRemoveEnvVar = (i) => setEnvVars((p) => p.filter((_, idx) => idx !== i));

  const handleEnvVarsPaste = (i, e) => {
    const t = e.clipboardData.getData("text");
    if (t.includes("\n") && t.includes("=")) {
      e.preventDefault();
      const parsed = t
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l.includes("="))
        .map((l) => {
          const idx = l.indexOf("=");
          return { key: l.slice(0, idx), value: l.slice(idx + 1) };
        });
      setEnvVars((p) => {
        const before = p.slice(0, i);
        const after = p.slice(i + 1);
        return [...before, ...parsed, ...after];
      });
    }
  };

  const closeUpdateProjectModal = () => {
    setIsProjectUpdate(false);
    setModalStep(0);
    setSelectedDomains([]);
    setRootDirectory("");
    setOutputDirectory("");
    setBuildCommand("");
    setInstallCommand("");
    setChangeEnvironmentOpen(false);
    setEnvVars([]);
    setBuildLogs([]);
    setTypedText("");
    setIsBuilding(false);
    setSuccessfulDeployment(false);
    setDeployedSubdomains([]);
  };

  function buildDirectoryTree(files) {
    const root = { __files: [] };
    files.forEach((f) => {
      const parts = f.filename.split("/");
      let cur = root;
      parts.forEach((p, idx) => {
        if (idx === parts.length - 1) cur.__files.push(f);
        else {
          if (!cur[p]) cur[p] = { __files: [] };
          cur = cur[p];
        }
      });
    });
    return root;
  }

  const renderFileTree = (node, path = "", depth = 0) => {
    const subDirs = Object.keys(node).filter((k) => k !== "__files");
    const files = node.__files || [];
    return (
      <div>
        {subDirs.map((dir) => {
          const fp = path ? `${path}/${dir}` : dir;
          const open = !!openDirs[fp];
          return (
            <div
              key={fp}
              style={{
                marginLeft: depth * 10,
                minWidth: depth > 4 ? `${220 + (depth - 4) * 10}px` : "220px"
              }}
            >
              <button
                className="updateSideBarButton"
                onClick={() =>
                  setOpenDirs((p) => ({ ...p, [fp]: !p[fp] }))
                }
              >
                <span>
                  <FontAwesomeIcon icon={open ? faMinusSquare : faPlusSquare} />
                  <FontAwesomeIcon icon={open ? faFolderOpen : faFolder} />
                  {dir}
                </span>
              </button>
              {open && renderFileTree(node[dir], fp, depth + 1)}
            </div>
          );
        })}
        {files.map((file) => (
          <div
            key={file.sha}
            style={{
              marginLeft: depth * 10,
              minWidth: depth > 4 ? `${220 + (depth - 4) * 10}px` : "220px"
            }}
          >
            <button
              className="updateSideBarButton"
              onClick={() => setSelectedFile(file)}
            >
              <span>
                <FontAwesomeIcon icon={faFile} />
                <p>{file.filename.split("/").pop()}</p>
              </span>
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderDiffView = (patch) => {
    if (!patch)
      return (
        <p className="fileDiffBinaryNote">
          Binary file not shown, or no diff available.
        </p>
      );
    return (
      <div className="dileDiffChangeWrapperMeta">
        <div className="fileDiffChangeWrapper">
          {patch.split("\n").map((line, idx) => {
            let c = "fileDiffLine";
            if (line.startsWith("@@")) c += " diffChunkHeader";
            else if (line.startsWith("+") && !line.startsWith("+++")) c += " diffAdd";
            else if (line.startsWith("-") && !line.startsWith("---")) c += " diffRemove";
            return (
              <div key={idx} className={c}>
                <div className="lineNumberMargin">{idx + 1}</div>
                <div className="lineContent">{line}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="updateDetailsPageWrapper"
      style={{
        background: "linear-gradient(to bottom, #322A54, #29282D)",
        display: screenSize >= 5300 ? "none" : ""
      }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && commitData && (
        <div className="updateDetailsCellHeaderContainer">
          <div className="updateDetailsTopBar">
            <span>
              <h1>
                {totalFilesChanged} {totalFilesChanged !== 1 ? "files" : "file"} changed
              </h1>
              <div>
                <span style={{ color: "#21BF68" }}>
                  +{totalAdditions} <small>additions</small>
                </span>
                <span style={{ color: "#E54B4B" }}>
                  -{totalDeletions} <small>deletions</small>
                </span>
              </div>
            </span>
            <div className="updateDetailsTopBarCommitInfo">
              <span>
                <label className="updateDetailsTopBarCommitInfoBranch">
                  <FontAwesomeIcon icon={faCodeBranch} />{" "}
                  <span className="branchName">{branch}</span>
                </label>
                <label className="updateDetailsTopBarCommitInfoSha">
                  {parentCount} parent{parentCount !== 1 ? "s" : ""}
                  {parentSha && (
                    <a href={parentUrl} target="_blank" rel="noopener noreferrer">
                      {parentSha.substring(0, 7)}
                    </a>
                  )}{" "}
                  commit{" "}
                  {commitSha && (
                    <a href={commitUrl} target="_blank" rel="noopener noreferrer">
                      {commitSha.substring(0, 7)}
                    </a>
                  )}{" "}
                  <button disabled={copyStatus[commitSha]} onClick={() => handleCopy(commitSha)}>
                    <FontAwesomeIcon icon={copyStatus[commitSha] ? faCheckSquare : faClone} />
                  </button>
                </label>
              </span>
            </div>
          </div>
          <div className="updateCellContentWrapper">
            <div className="updateContentSideBar">
              <div className="updateSideBarSearchWrapper">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="searchIcon" />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                />
              </div>
              <div className="updateSideBarButtonWrapper">
                {directoryTree && renderFileTree(directoryTree, "", 0)}
              </div>
            </div>
            <div className="updateContentMainFlexWrapper">
              <div className="updateContentMainTopBarSupplement">
                {commitStatus && (
                  <label className="updateDetailsTopBarCommitStatus">
                    Commit is <i>{commitStatus.status}</i> last deployment.
                    <span>
                      {commitStatus.status === "before"
                        ? "Nothing to do!"
                        : "Do you want to update your deployment?"}
                    </span>
                  </label>
                )}
                {commitStatus?.status === "after" && (
                  <div className="updateDetailsTopBarSupplementButtonFlex">
                    <button onClick={() => setIsProjectUpdate(true)}>Update Project</button>
                    <button onClick={() => navigate("/add-new-project")}>Build New</button>
                  </div>
                )}
              </div>
              <div className="updateContentMainFlex">
                {selectedFile ? (
                  <div key={selectedFile.sha} className="fileDiffCell">
                    <div className="fileDiffHeader">
                      <span className="fileDiffHeaderFileName">
                        {selectedFile.filename}
                        <button disabled={copyStatus[selectedFile.filename]} onClick={() => handleCopy(selectedFile.filename)}>
                          <FontAwesomeIcon icon={copyStatus[selectedFile.filename] ? faCheckSquare : faClone} />
                        </button>
                      </span>
                      <span className="fileDiffHeaderSupplement">
                        <span className="fileDiffStatus">{selectedFile.status}</span>
                        <span className="fileDiffStatus">
                          <p style={{ color: "#21BF68" }}>+{selectedFile.additions}</p>
                          <p style={{ color: "#E54B4B" }}>-{selectedFile.deletions}</p>
                        </span>
                      </span>
                    </div>
                    <div className="fileDiffContent">{renderDiffView(selectedFile.patch)}</div>
                  </div>
                ) : (
                  filteredFiles.map((file) => (
                    <div key={file.sha} className="fileDiffCell">
                      <div className="fileDiffHeader">
                        <span className="fileDiffHeaderFileName">
                          {file.filename}
                          <button disabled={copyStatus[file.filename]} onClick={() => handleCopy(file.filename)}>
                            <FontAwesomeIcon icon={copyStatus[file.filename] ? faCheckSquare : faClone} />
                          </button>
                        </span>
                        <span className="fileDiffHeaderSupplement">
                          <span className="fileDiffStatus">{file.status}</span>
                          <span className="fileDiffStatus">
                            <p style={{ color: "#21BF68" }}>+{file.additions}</p>
                            <p style={{ color: "#E54B4B" }}>-{file.deletions}</p>
                          </span>
                        </span>
                      </div>
                      <div className="fileDiffContent">{renderDiffView(file.patch)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {isProjectUpdate && (
        <div className="projectUpdateModalOverlay">
          <div className="projectUpdateModalContainer" style={{ position: "relative" }}>
            <div className="projectUpdateModalHeader">
              <h2>
                Update Project: <i>{projectName}</i>
              </h2>
              <button onClick={closeUpdateProjectModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="projectUpdateModalBody">
              {modalStep === 0 && (
                <div className="projectUpdateDeploymentContentShort">
                  <small style={{ padding: 0 }}>
                    Select which domains you would like to update this project on:
                  </small>
                  {domains.map((d) => (
                    <div key={d.domainID} className="projectUpdateDomainItem">
                      <input
                        type="checkbox"
                        className="stackforgeIDESettingsCheckbox"
                        checked={selectedDomains.includes(d.domainID)}
                        onChange={() =>
                          setSelectedDomains((p) =>
                            p.includes(d.domainID)
                              ? p.filter((x) => x !== d.domainID)
                              : [...p, d.domainID]
                          )
                        }
                      />
                      <p>
                        {d.domainName} ({d.environment || "Production"})
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {modalStep === 1 && (
                <div className="projectUpdateDeploymentContent">
                  <div className="projectUpdateInputContainer" style={{ paddingTop: 0 }}>
                    <label>Root Directory</label>
                    <div className="projectUpdateInputWrapperRounded">
                      <div className="projectUpdateIcon">./</div>
                      <input
                        type="text"
                        className="projectUpdateInput"
                        placeholder="Change your root directory?"
                        value={rootDirectory === "." || rootDirectory === "./" ? "" : rootDirectory}
                        onChange={(e) =>
                          setRootDirectory(
                            e.target.value === "." || e.target.value === "./" ? "" : e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="projectUpdateInputContainer">
                    <label>Output Directory</label>
                    <div className="projectUpdateInputWrapperRounded">
                      <div className="projectUpdateIcon">./</div>
                      <input
                        type="text"
                        className="projectUpdateInput"
                        placeholder="Change your output directory?"
                        value={outputDirectory === "." || outputDirectory === "./" ? "" : outputDirectory}
                        onChange={(e) =>
                          setOutputDirectory(
                            e.target.value === "." || e.target.value === "./" ? "" : e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {modalStep === 2 && (
                <div className="projectUpdateDeploymentContent">
                  <div className="projectUpdateInputContainer" style={{ paddingTop: 0 }}>
                    <label>Build Command</label>
                    <div className="projectUpdateInputWrapperRounded">
                      <input
                        type="text"
                        className="projectUpdateInput"
                        placeholder="Change your build command?"
                        value={buildCommand}
                        onChange={(e) => setBuildCommand(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="projectUpdateInputContainer">
                    <label>Install Command</label>
                    <div className="projectUpdateInputWrapperRounded">
                      <input
                        type="text"
                        className="projectUpdateInput"
                        placeholder="Change your install command?"
                        value={installCommand}
                        onChange={(e) => setInstallCommand(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
              {modalStep === 3 && (
                <div className="projectUpdateDeploymentContent">
                  {envVars.length > 0 && (
                    <div className="projectUpdateDeploymentContentHeaderFlex">
                      <label>Environment Variables</label>
                      <button onClick={handleAddEnvVar}>
                        <FontAwesomeIcon icon={faPlusSquare} />
                        Add Environment Variable
                      </button>
                    </div>
                  )}
                  {envVars.length > 0 ? (
                    <div className="updateProjectEnvVarsWrapper">
                      {envVars.map((envVar, i) => (
                        <div key={i} className="updateProjectEnvVarsRow">
                          <div className="updateProjectOperationsField" style={{ backgroundColor: "rgba(30, 30, 30, 0.4)" }}>
                            <input
                              type="text"
                              className="projectUpdateInput"
                              placeholder="Key"
                              value={envVar.key}
                              onChange={(e) => handleEnvVarChange(i, "key", e.target.value)}
                              onPaste={(e) => handleEnvVarsPaste(i, e)}
                              style={{ color: "white" }}
                            />
                          </div>
                          <div className="updateProjectOperationsField" style={{ backgroundColor: "rgba(30, 30, 30, 0.4)" }}>
                            <input
                              type="text"
                              className="projectUpdateInput"
                              placeholder="Value"
                              value={envVar.value}
                              onChange={(e) => handleEnvVarChange(i, "value", e.target.value)}
                              onPaste={(e) => handleEnvVarsPaste(i, e)}
                              style={{ color: "white" }}
                            />
                          </div>
                          <button className="updateProjectEnvVarsRemoveBtn" onClick={() => handleRemoveEnvVar(i)}>
                            -
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="noEnvVarsAvailable">
                      <FontAwesomeIcon icon={faKey} />
                      <p>No environment variables in prior builds.</p>
                      <button onClick={handleAddEnvVar}>
                        <FontAwesomeIcon icon={faPlusSquare} />
                        Add Environment Variable
                      </button>
                    </div>
                  )}
                </div>
              )}
              {modalStep === 4 && (
                <div className="projectUpdateDeploymentContent">
                  <small>Review your information:</small>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(0)}>
                    <span>
                      <label>Domains:</label>
                      <i>
                        {domains
                          .filter((d) => selectedDomains.includes(d.domainID))
                          .map((d) => d.domainName)
                          .join(", ")}
                      </i>
                    </span>
                  </div>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(1)}>
                    <span>
                      <label>Root Directory:</label>
                      <i>
                        {rootDirectory === "." || rootDirectory === "./" || rootDirectory === ""
                          ? "null"
                          : rootDirectory}
                      </i>
                    </span>
                  </div>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(1)}>
                    <span>
                      <label>Output Directory:</label>
                      <i>
                        {outputDirectory === "." || outputDirectory === "./" || outputDirectory === ""
                          ? "null"
                          : outputDirectory}
                      </i>
                    </span>
                  </div>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(2)}>
                    <span>
                      <label>Build Command:</label>
                      <i>{buildCommand || "N/A"}</i>
                    </span>
                  </div>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(2)}>
                    <span>
                      <label>Install Command:</label>
                      <i>{installCommand || "N/A"}</i>
                    </span>
                  </div>
                  <div className="projectUpdateDomainItemSupplement" onClick={() => setModalStep(3)}>
                    <span>
                      <label>Environment Variables:</label>
                      <i>
                        {envVars.length > 0
                          ? envVars.map((e) => `${e.key}=${e.value}`).join(", ")
                          : "N/A"}
                      </i>
                    </span>
                  </div>
                </div>
              )}

              {modalStep === 5 && (
                <div className="projectUpdateDeploymentContent">
                  <div className="updateLogsHeader">
                    <span>
                      <h3>Project Build Logs</h3>
                      <button onClick={handleCopyLogs} disabled={!buildLogsString}>
                        <FontAwesomeIcon icon={copied ? faSquareCheck : faClone} />
                      </button>
                    </span>
                    {isBuilding && <div className="loading-circle-supplement" />}
                  </div>
                  <div className="importProjectsBuildLogsCell" ref={logsContainerRef}>
                    {typedText === "" ? (
                      <div className="noBuildLogsDisplay">
                        <FontAwesomeIcon icon={faGlobe} />
                      </div>
                    ) : (
                      <>
                        {typedText.split("\n").map((line, i) => {
                          if (line.startsWith("Update completed successfully for subdomains:")) {
                            return (
                              <div className="importProjectsBuildLogsCellLogDisplay" key={i}>
                                <span className="log-content successLogLine">{line}</span>
                              </div>
                            );
                          }
                          const m = line.match(/^(\s*)(.*)$/);
                          const indent = m ? m[1] : "";
                          const content = m ? m[2] : "";
                          const cleaned = content.replace(/`+/g, "");
                          let logClass = "";
                          if (content.startsWith("ERROR:")) logClass = "errorLogLine";
                          else if (content.startsWith("WARNING:")) logClass = "warningLogLine";
                          else if (content.startsWith("INFO:")) logClass = "infoLogLine";
                          else if (content.startsWith("DEBUG:")) logClass = "debugLogLine";
                          return (
                            <div className="importProjectsBuildLogsCellLogDisplay" key={i}>
                              {indent}
                              <span className={`log-content ${logClass}`}>{cleaned}</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="projectUpdateModalFooter">
              <button disabled={successfulDeployment} onClick={closeUpdateProjectModal}>
                Cancel
              </button>
              <span>
                {modalStep > 0 && modalStep < 5 && (
                  <button onClick={() => setModalStep(modalStep - 1)}>Back</button>
                )}
                {modalStep < 4 && (
                  <button
                    disabled={modalStep === 0 && selectedDomains.length === 0}
                    onClick={() => setModalStep(modalStep + 1)}
                  >
                    Next
                  </button>
                )}
                {modalStep === 4 && <button onClick={handleConfirm}>Confirm</button>}
                {modalStep === 5 && !isBuilding && (
                  <button
                    onClick={() => { closeUpdateProjectModal(); navigate("/stackforge") }}
                    style={{ backgroundColor: successfulDeployment ? "#9B68DD" : "" }}
                  >
                    Close
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      {!isLoaded && (
        <div className="updateDetailsCellHeaderContainer" style={{ justifyContent: "center" }}>
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title">Stack Forge</label>
          </div>
        </div>
      )}
    </div>
  );
};

export default StackForgeUpdateDetails;
