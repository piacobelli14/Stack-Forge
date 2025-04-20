import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFile,
  faFolder,
  faFolderOpen,
  faPlusSquare,
  faMinusSquare,
  faMagnifyingGlass,
  faSearch,
  faCopy,
  faClone,
  faCheckSquare,
  faCodeBranch
} from "@fortawesome/free-solid-svg-icons";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeUpdateDetails.css";
import "../../styles/helperStyles/LoadingSpinner.css";

const StackForgeUpdateDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, userID, loading } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [commitData, setCommitData] = useState(null);
  const { commitDetails, repository, owner, branchName } = location.state || {};
  const [fileFilter, setFileFilter] = useState("");
  const filteredFiles = commitData?.files?.filter((file) =>
    file.filename.toLowerCase().includes(fileFilter.toLowerCase())
  );
  const directoryTree = filteredFiles ? buildDirectoryTree(filteredFiles) : null;
  const [openDirs, setOpenDirs] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const totalFilesChanged = commitData?.files?.length || 0;
  const totalAdditions = commitData?.stats?.additions || 0;
  const totalDeletions = commitData?.stats?.deletions || 0;
  const [copyStatus, setCopyStatus] = useState({});
  const branch = branchName || "";
  const parentCount = commitData?.parents?.length || 0;
  const parentSha = commitData?.parents?.[0]?.sha || "";
  const parentUrl = commitData?.parents?.[0]?.html_url || "";
  const commitSha = commitData?.sha || "";
  const commitUrl = commitData?.html_url || "";
  const commitMessage = commitData?.commit?.message || commitDetails?.commit?.message || "";

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopyStatus((prev) => ({ ...prev, [text]: true }));
    setTimeout(() => {
      setCopyStatus((prev) => ({ ...prev, [text]: false }));
    }, 2000);
  };

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      await fetchCommitDetails();
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
    if (commitData && commitData.files && commitData.files.length > 0) {
      const filtered = commitData.files.filter((file) =>
        file.filename.toLowerCase().includes(fileFilter.toLowerCase())
      );
      if (filtered.length > 0) {
        const tree = buildDirectoryTree(filtered);
        const newOpen = getAllDirPaths(tree, "");
        setOpenDirs(newOpen);
      }
    }
  }, [commitData, fileFilter]);

  const fetchCommitDetails = async () => {
    try {
      const response = await fetch("http://localhost:3000/git-commit-details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userID: userID,
          owner: owner,
          repo: repository,
          commitSha: commitDetails?.sha
        })
      });
      if (!response.ok) {
        throw new Error("Failed to fetch commit details");
      }
      const data = await response.json();
      setCommitData(data);
    } catch (error) {}
  };

  function buildDirectoryTree(files) {
    const root = { __files: [] };
    files.forEach((file) => {
      const parts = file.filename.split("/");
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        if (i === parts.length - 1) {
          current.__files.push(file);
        } else {
          const dir = parts[i];
          if (!current[dir]) {
            current[dir] = { __files: [] };
          }
          current = current[dir];
        }
      }
    });
    return root;
  }

  function getAllDirPaths(node, path = "") {
    let acc = {};
    Object.keys(node).forEach((key) => {
      if (key !== "__files") {
        const fullPath = path ? `${path}/${key}` : key;
        acc[fullPath] = true;
        Object.assign(acc, getAllDirPaths(node[key], fullPath));
      }
    });
    return acc;
  }

  const renderFileTree = (node, path = "", depth = 0) => {
    const subdirectories = Object.keys(node).filter((key) => key !== "__files");
    const files = node.__files || [];
    return (
      <div>
        {subdirectories.map((dirName) => {
          const fullPath = path ? `${path}/${dirName}` : dirName;
          const isOpen = !!openDirs[fullPath];
          return (
            <div
              key={fullPath}
              style={{
                marginLeft: depth * 10,
                minWidth: depth > 4 ? `${220 + (depth - 4) * 10}px` : "220px"
              }}
            >
              <button className="updateSideBarButton" onClick={() => toggleDir(fullPath)}>
                <span>
                  <FontAwesomeIcon icon={isOpen ? faMinusSquare : faPlusSquare} />
                  <FontAwesomeIcon icon={isOpen ? faFolderOpen : faFolder} />
                  {dirName}
                </span>
              </button>
              {isOpen && renderFileTree(node[dirName], fullPath, depth + 1)}
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
            <button className="updateSideBarButton" onClick={() => setSelectedFile(file)}>
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
    if (!patch) {
      return <p className="fileDiffBinaryNote">Binary file not shown, or no diff available.</p>;
    }
    const lines = patch.split("\n");
    return (
      <div className="dileDiffChangeWrapperMeta">
        <div className="fileDiffChangeWrapper">
          {lines.map((line, index) => {
            let lineClass = "fileDiffLine";
            if (line.startsWith("@@")) {
              lineClass += " diffChunkHeader";
            } else if (line.startsWith("+") && !line.startsWith("+++")) {
              lineClass += " diffAdd";
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              lineClass += " diffRemove";
            }
            return (
              <div key={index} className={lineClass}>
                <div className="lineNumberMargin">{index + 1}</div>
                <div className="lineContent">{line}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const toggleDir = (dirPath) => {
    setOpenDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
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
                <h1>{totalFilesChanged} {totalFilesChanged.length > 1 ? "files" : "file"} changed</h1>
                <div>
                    <span style={{ color: "#21BF68" }}>+{totalAdditions}</span>
                    <span style={{ color: "#E54B4B" }}>-{totalDeletions}</span>
                </div>
            </span>


            <div className="updateDetailsTopBarCommitInfo">
                <span>
                    <label className="updateDetailsTopBarCommitInfoBranch">
                        <FontAwesomeIcon icon={faCodeBranch} />
                        <span className="branchName">{branch}</span>
                    </label>

                    <label className="updateDetailsTopBarCommitInfoSha">
                        {parentCount} parent{parentCount !== 1 ? "s" : ""}
                        {parentSha && (
                            <a href={parentUrl} target="_blank" rel="noopener noreferrer">
                                {parentSha.substring(0, 7)}
                            </a>
                        )}
                        commit
                        {commitSha && (
                            <a href={commitUrl} target="_blank" rel="noopener noreferrer">
                                {commitSha.substring(0, 7)}
                            </a>
                        )}
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
            <div className="updateContentMainFlex">
              {selectedFile ? (
                <div key={selectedFile.sha} className="fileDiffCell">
                  <div className="fileDiffHeader">
                    <span className="fileDiffHeaderFileName">
                      {selectedFile.filename}
                      <button
                        disabled={copyStatus[selectedFile.filename]}
                        onClick={() => handleCopy(selectedFile.filename)}
                      >
                        <FontAwesomeIcon
                          icon={copyStatus[selectedFile.filename]
                            ? faCheckSquare
                            : faClone}
                        />
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
                filteredFiles &&
                filteredFiles.map((file) => (
                  <div key={file.sha} className="fileDiffCell">
                    <div className="fileDiffHeader">
                      <span className="fileDiffHeaderFileName">
                        {file.filename}
                        <button
                          disabled={copyStatus[file.filename]}
                          onClick={() => handleCopy(file.filename)}
                        >
                          <FontAwesomeIcon
                            icon={copyStatus[file.filename]
                              ? faCheckSquare
                              : faClone}
                          />
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
