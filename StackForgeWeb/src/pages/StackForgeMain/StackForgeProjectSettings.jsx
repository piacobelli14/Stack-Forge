import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faPenToSquare,
  faClone,
  faSquareCheck,
  faGears,
  faIdCard,
  faCaretDown,
} from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgemainStyles/StackForgeProjectSettings.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProjectSettings = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTouchDevice = useIsTouchDevice();
  const { token, userID, loading, organizationID } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [resizeTrigger, setResizeTrigger] = useState(false);
  const scrollContainerRef = useRef(null);
  const { project, settingsState: initialSettingsState } = location.state || {};
  const [settingsState, setSettingsState] = useState(
    initialSettingsState || "general"
  );
  const [editModes, setEditModes] = useState({ projectName: false });
  const [projectImage, setProjectImage] = useState(project?.image || "");
  const [projectName, setProjectName] = useState(project?.name || "");
  const [projectID, setProjectID] = useState(project?.project_id || "");
  const [domainName, setDomainName] = useState(project?.domain || "");
  const [projectIDCopied, setProjectIDCopied] = useState(false);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainLoadingStates, setDomainLoadingStates] = useState({});
  const [domains, setDomains] = useState([]);
  const [selectedDomainStates, setSelectedDomainStates] = useState({});
  const [domainEditModes, setDomainEditModes] = useState({});
  const redirectButtonRefs = useRef({});
  const redirectDropdownRefs = useRef({});
  const environmentButtonRefs = useRef({});
  const environmentDropdownRefs = useRef({});
  const [redirectDropdownOpen, setRedirectDropdownOpen] = useState({});
  const [environmentDropdownOpen, setEnvironmentDropdownOpen] = useState({});
  const [redirectDropdownPositions, setRedirectDropdownPositions] = useState({});
  const [environmentDropdownPositions, setEnvironmentDropdownPositions] = useState({});

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoaded(true);
        await fetchDomains();
      } catch {}
    };
    if (!loading && token) fetchData();
  }, [userID, loading, token]);

  useEffect(() => {
    const handleResize = () => {
      setIsLoaded(false);
      setScreenSize(window.innerWidth);
      setResizeTrigger((prev) => !prev);
      setRedirectDropdownOpen({});
      setEnvironmentDropdownOpen({});
      setTimeout(() => setIsLoaded(true), 300);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setRedirectDropdownOpen({});
      setEnvironmentDropdownOpen({});
    };

    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
    }

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  useEffect(() => {
    domains.forEach((domain) => {
      const domainID = domain.domainID;
      if (
        redirectDropdownOpen[domainID] &&
        redirectButtonRefs.current[domainID] &&
        redirectDropdownRefs.current[domainID]
      ) {
        const buttonRect = redirectButtonRefs.current[domainID].getBoundingClientRect();
        const dropdownRect = redirectDropdownRefs.current[domainID].getBoundingClientRect();
        let newTop = buttonRect.bottom + 5;
        let newLeft = buttonRect.right - dropdownRect.width;
        if (newTop + dropdownRect.height > window.innerHeight) {
          newTop = window.innerHeight - dropdownRect.height;
        }
        if (newLeft < 0) {
          newLeft = 0;
        }
        setRedirectDropdownPositions((prev) => ({
          ...prev,
          [domainID]: { top: newTop, left: newLeft },
        }));
      }
      if (
        environmentDropdownOpen[domainID] &&
        environmentButtonRefs.current[domainID] &&
        environmentDropdownRefs.current[domainID]
      ) {
        const buttonRect = environmentButtonRefs.current[domainID].getBoundingClientRect();
        const dropdownRect = environmentDropdownRefs.current[domainID].getBoundingClientRect();
        let newTop = buttonRect.bottom + 5;
        let newLeft = buttonRect.right - dropdownRect.width;
        if (newTop + dropdownRect.height > window.innerHeight) {
          newTop = window.innerHeight - dropdownRect.height;
        }
        if (newLeft < 0) {
          newLeft = 0;
        }
        setEnvironmentDropdownPositions((prev) => ({
          ...prev,
          [domainID]: { top: newTop, left: newLeft },
        }));
      }
    });
  }, [redirectDropdownOpen, environmentDropdownOpen, domains]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      let shouldCloseRedirect = true;
      let shouldCloseEnvironment = true;
      domains.forEach((domain) => {
        const domainID = domain.domainID;
        if (
          redirectButtonRefs.current[domainID] &&
          redirectButtonRefs.current[domainID].contains(event.target)
        ) {
          shouldCloseRedirect = false;
        }
        if (
          redirectDropdownRefs.current[domainID] &&
          redirectDropdownRefs.current[domainID].contains(event.target)
        ) {
          shouldCloseRedirect = false;
        }
        if (
          environmentButtonRefs.current[domainID] &&
          environmentButtonRefs.current[domainID].contains(event.target)
        ) {
          shouldCloseEnvironment = false;
        }
        if (
          environmentDropdownRefs.current[domainID] &&
          environmentDropdownRefs.current[domainID].contains(event.target)
        ) {
          shouldCloseEnvironment = false;
        }
      });
      if (shouldCloseRedirect) {
        setRedirectDropdownOpen({});
      }
      if (shouldCloseEnvironment) {
        setEnvironmentDropdownOpen({});
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [domains]);

  const fetchDomains = async () => {
    setDomainsLoading(true);
    try {
      const response = await fetch("http://localhost:3000/project-domains", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userID, organizationID, projectID }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch domains: ${response.status}`);
      }

      const data = await response.json();
      setDomains(
        data.domains.map((domain) => ({
          ...domain,
          environment: domain.environment
            ? domain.environment.charAt(0).toUpperCase() +
              domain.environment.slice(1).toLowerCase()
            : domain.environment,
        })) || []
      );

      const recordStates = {};
      (data.domains || []).forEach((domain) => {
        recordStates[domain.domainID] = "ARecord";
      });
      setSelectedDomainStates(recordStates);
    } catch (error) {
      await showDialog({
        title: "Error",
        message: `Failed to load domains: ${error.message}`,
      });
    } finally {
      setDomainsLoading(false);
    }
  };

  const validateDomain = async (domainID, domainName) => {
    setDomainLoadingStates((prev) => ({ ...prev, [domainID]: true }));
    try {
      const response = await fetch("http://localhost:3000/validate-domain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userID, organizationID, projectID, domain: domainName }),
      });

      if (!response.ok) {
        throw new Error(`Failed to validate domain: ${response.status}`);
      }

      const data = await response.json();
      setDomains((prev) =>
        prev.map((d) =>
          d.domainID === domainID ? { ...d, ...data, dnsRecords: data.dnsRecords || [] } : d
        )
      );
    } catch (error) {
      await showDialog({
        title: "Error",
        message: `Failed to validate domain: ${error.message}`,
      });
    } finally {
      setDomainLoadingStates((prev) => ({ ...prev, [domainID]: false }));
    }
  };

  const updateRedirect = async (domainID, redirectTarget) => {
    const payload = { userID, organizationID, projectID, domainID, redirectTarget };
    try {
      const response = await fetch("http://localhost:3000/edit-redirect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to update redirect: ${response.status}`);
      }

      setDomains((prev) =>
        prev.map((d) => (d.domainID === domainID ? { ...d, redirectTarget } : d))
      );
    } catch (error) {
      await showDialog({
        title: "Error",
        message: error.message,
      });
    }
  };

  const updateEnvironment = async (domainID, environment) => {
    const payload = { userID, organizationID, projectID, domainID, environment };
    try {
      const response = await fetch("http://localhost:3000/edit-environment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to update environment: ${response.status}`);
      }

      setDomains((prev) =>
        prev.map((d) => (d.domainID === domainID ? { ...d, environment } : d))
      );
    } catch (error) {
      await showDialog({
        title: "Error",
        message: error.message,
      });
    }
  };

  const toggleRedirectDropdown = (domainID) => {
    setRedirectDropdownOpen((prev) => ({
      ...prev,
      [domainID]: !prev[domainID],
    }));
    setEnvironmentDropdownOpen((prev) => ({
      ...prev,
      [domainID]: false,
    }));
  };

  const toggleEnvironmentDropdown = (domainID) => {
    setEnvironmentDropdownOpen((prev) => ({
      ...prev,
      [domainID]: !prev[domainID],
    }));
    setRedirectDropdownOpen((prev) => ({
      ...prev,
      [domainID]: false,
    }));
  };

  const handleRedirectSelect = (domainID, redirectTarget) => {
    updateRedirect(domainID, redirectTarget);
    setRedirectDropdownOpen((prev) => ({
      ...prev,
      [domainID]: false,
    }));
  };

  const handleEnvironmentSelect = (domainID, environment) => {
    const capitalizedEnvironment =
      environment.charAt(0).toUpperCase() + environment.slice(1).toLowerCase();
    updateEnvironment(domainID, capitalizedEnvironment);
    setEnvironmentDropdownOpen((prev) => ({
      ...prev,
      [domainID]: false,
    }));
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
  };

  const handleProjectImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file)
      return await showDialog({ title: "Alert", message: "No file selected!" });
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result;
        try {
          const token = localStorage.getItem("token");
          if (!token) return;
          const res = await fetch("http://localhost:3000/edit-project-image", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userID, organizationID, projectID, image: base64Data }),
          });
          if (!res.ok)
            return await showDialog({
              title: "Alert",
              message: `Error uploading image: ${res.status} - ${await res.text()}`,
            });
          setProjectImage(base64Data);
          e.target.value = "";
        } catch (uploadError) {
          await showDialog({
            title: "Alert",
            message: `Image upload failed: ${uploadError.message}`,
          });
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      await showDialog({ title: "Alert", message: `An error occurred: ${error.message}` });
    }
  };

  const handleSaveProjectInfo = async (fieldKey, value) => {
    const endpoints = {
      projectName: "edit-project-name",
    };
    if (value === "" || !value) {
      return;
    }
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:3000/" + endpoints[fieldKey], {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userID, organizationID, projectID, [fieldKey]: value }),
      });
      if (res.status !== 200) throw new Error("Internal Server Error");
      setEditModes((prev) => ({ ...prev, [fieldKey]: false }));
    } catch {}
  };

  const handleProjectDelete = async () => {
    let isConfirmed = false;
    while (!isConfirmed) {
      const result = await showDialog({
        title: "Confirm Project Deletion",
        message: `Type 'delete my project - ${projectName}' to confirm deletion.`,
        inputs: [{ name: "confirmation", type: "text", defaultValue: "" }],
        showCancel: true,
      });
      if (!result) {
        return; 
      }
      if (result.confirmation === `delete my project - ${projectName}`) {
        isConfirmed = true;
      } else {
        continue;
      }
    }
    setIsLoaded(false);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:3000/delete-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userID, organizationID, projectID, projectName, domainName: projectName }),
      });
      if (response.status !== 200) {
        throw new Error("Internal Server Error");
      } else {
        navigate("/stackforge");
      }
    } catch {
      return;
    }
  };

  const handleProjectIDCopy = () => {
    copyText(projectID);
    setProjectIDCopied(true);
    setTimeout(() => setProjectIDCopied(false), 2000);
  };

  return (
    <div
      className="projectSettingsPageWrapper"
      style={{
        background: "linear-gradient(to bottom, #322A54, #29282D)",
        display: screenSize >= 5300 ? "none" : "",
      }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && (
        <div className="projectSettingsCellHeaderContainer">
          <div className="projectSettingsCellContentWrapper">
            <div className="projectSettingsContentSideBar">
              <div className="projectSettingsSideBarButtonWrapper">
                <button
                  className={
                    "projectSettingsSideBarButton " +
                    (settingsState === "general"
                      ? "projectSettingsSideBarButton--selected"
                      : "")
                  }
                  onClick={() => setSettingsState("general")}
                >
                  <span>
                    <FontAwesomeIcon icon={faGears} />
                    General
                  </span>
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                </button>
                <button
                  className={
                    "projectSettingsSideBarButton " +
                    (settingsState === "domains"
                      ? "projectSettingsSideBarButton--selected"
                      : "")
                  }
                  onClick={() => setSettingsState("domains")}
                >
                  <span>
                    <FontAwesomeIcon icon={faIdCard} />
                    Domains
                  </span>
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                </button>
              </div>
            </div>

            <div className="projectsettingsContentMainFlex">
              <div className="projectSettingsContentMainScroll" ref={scrollContainerRef}>
                {settingsState === "general" && (
                  <>
                    <div className="projectSettingsContentFlexCell">
                      <div className="projectSettingsContentFlexCellTop">
                        <div className="projectSettingsLeadingCellStack">
                          <h3>Project Picture</h3>
                          <p>
                            This is the picture associated with your project. It could be a logo,
                            a screenshot, or just the image you want your project represented by.
                          </p>
                        </div>
                        <div
                          className="projectSettingsTrailingCellStack"
                          style={{ justifyContent: "center", alignItems: "center" }}
                        >
                          <label
                            className="projectSettingsUserImageWrapper"
                            htmlFor="projectImageUpload"
                            style={{
                              background: projectImage && projectImage !== "" ? "none" : "",
                              boxShadow: projectImage && projectImage !== "" ? "none" : "",
                            }}
                          >
                            <img src={projectImage} className="projectSettingsUserImage" alt="" />
                          </label>
                          <input
                            style={{ display: "none", padding: 0 }}
                            type="file"
                            id="projectImageUpload"
                            accept="image/*"
                            onChange={handleProjectImageChange}
                          />
                        </div>
                      </div>
                      <div className="projectSettingsContentFlexCellBottom">
                        <p>
                          A project image is not required, but if you don't select one, the
                          Stackforge logo will be assigned to it.
                        </p>
                      </div>
                    </div>

                    <div className="projectSettingsContentFlexCell">
                      <div className="projectSettingsContentFlexCellTop">
                        <div className="projectSettingsLeadingCellStack">
                          <h3>Project Info</h3>
                          <p>
                            This is the name and project ID associated with your project. You can
                            not change the project ID assigned by Stackforge.
                          </p>
                        </div>
                        <div
                          className="projectSettingsTrailingCellStack"
                          style={{ justifyContent: "center", alignItems: "center" }}
                        >
                          <div className="projectSettingsFieldInput">
                            <strong>Project Name</strong>
                            <span>
                              <input
                                placeholder={project?.project_name}
                                value={projectName}
                                disabled={!editModes.projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                              />
                              <button
                                className="projectSettingsEditButton"
                                onClick={() =>
                                  editModes.projectName
                                    ? handleSaveProjectInfo("projectName", projectName)
                                    : setEditModes((prev) => ({ ...prev, projectName: true }))
                                }
                              >
                                <FontAwesomeIcon
                                  icon={editModes.projectName ? faSquareCheck : faPenToSquare}
                                />
                              </button>
                            </span>
                          </div>
                          <div className="projectSettingsFieldInput">
                            <strong>Project ID</strong>
                            <span>
                              <input placeholder={projectID} disabled={true} />
                              <button
                                className="projectSettingsEditButton"
                                onClick={handleProjectIDCopy}
                                style={{ opacity: projectIDCopied ? "0.6" : "1.0" }}
                              >
                                <FontAwesomeIcon
                                  icon={projectIDCopied ? faSquareCheck : faClone}
                                />
                              </button>
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="projectSettingsContentFlexCellBottom">
                        <p>A project name is required.</p>
                      </div>
                    </div>

                    <div
                      className="projectSettingsContentFlexCell"
                      style={{ border: "1px solid #E54B4B" }}
                    >
                      <div className="projectSettingsContentFlexCellTop">
                        <div
                          className="projectSettingsLeadingCellStack"
                          style={{ width: "100%" }}
                        >
                          <h3>Delete Project</h3>
                          <p style={{ width: "100%" }}>
                            Permanently delete this project and all of its contents from the
                            platform. This is irreversible.
                          </p>
                          <button
                            className="projectSettingsDeleteButton"
                            onClick={handleProjectDelete}
                          >
                            Delete Project
                          </button>
                        </div>
                      </div>
                      <div
                        className="projectSettingsContentFlexCellBottom"
                        style={{
                          borderTop: "1px solid #E54B4B",
                          backgroundColor: "rgba(229, 75, 75, 0.2)",
                        }}
                      >
                        <p>This action is not reversible, so please continue with caution.</p>
                      </div>
                    </div>
                  </>
                )}

                {settingsState === "domains" && (
                  <>
                    {domainsLoading && domains.length === 0 ? (
                      <div className="loading-wrapper">
                        <div className="loading-circle" />
                      </div>
                    ) : (
                      domains.map((domain) => {
                        const recordTypeMap = {
                          ARecord: "A",
                          AAAARecord: "AAAA",
                          CNameRecord: "CNAME",
                        };
                        const selectedRecordType =
                          recordTypeMap[selectedDomainStates[domain.domainID]];
                        const dnsRecord = (domain.dnsRecords || []).find(
                          (record) => record.type === selectedRecordType
                        );

                        return (
                          <div
                            key={domain.domainID}
                            className="projectSettingsContentFlexCellStack"
                            style={{ position: "relative" }}
                          >
                            {domainLoadingStates[domain.domainID] && (
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
                            <div className="projectSettingsDomainHeader">
                              <span>
                                <strong>{domain.domainName}</strong>
                                <p>Details for the domain associated with this project.</p>
                              </span>
                              <div>
                                <button
                                  style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                                  onClick={() =>
                                    validateDomain(domain.domainID, domain.domainName)
                                  }
                                  disabled={domainLoadingStates[domain.domainID]}
                                >
                                  Refresh
                                </button>

                                <button
                                  style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                                  onClick={() =>
                                    setDomainEditModes((prev) => ({
                                      ...prev,
                                      [domain.domainID]: !prev[domain.domainID],
                                    }))
                                  }
                                  disabled={domainLoadingStates[domain.domainID]}
                                >
                                  {domainEditModes[domain.domainID] ? "Save" : "Edit"}
                                </button>
                              </div>
                            </div>
                                  
                            {!domainEditModes[domain.domainID] && (
                              <div className="projectSettingsDomainContent">
                                <div className="projectSettingsRecordStatusBar">
                                  <button
                                    onClick={() =>
                                      setSelectedDomainStates((prev) => ({
                                        ...prev,
                                        [domain.domainID]: "ARecord",
                                      }))
                                    }
                                    style={{
                                      borderBottom:
                                        selectedDomainStates[domain.domainID] === "ARecord"
                                          ? "2px solid #c1c1c1"
                                          : "none",
                                    }}
                                  >
                                    A Record
                                  </button>
                                  <button
                                    onClick={() =>
                                      setSelectedDomainStates((prev) => ({
                                        ...prev,
                                        [domain.domainID]: "AAAARecord",
                                      }))
                                    }
                                    style={{
                                      borderBottom:
                                        selectedDomainStates[domain.domainID] === "AAAARecord"
                                          ? "2px solid #c1c1c1"
                                          : "none",
                                    }}
                                  >
                                    AAAA Record
                                  </button>
                                  <button
                                    onClick={() =>
                                      setSelectedDomainStates((prev) => ({
                                        ...prev,
                                        [domain.domainID]: "CNameRecord",
                                      }))
                                    }
                                    style={{
                                      borderBottom:
                                        selectedDomainStates[domain.domainID] === "CNameRecord"
                                          ? "2px solid #c1c1c1"
                                          : "none",
                                    }}
                                  >
                                    CName Record
                                  </button>
                                </div>
                                <label>
                                  Set the following record on your DNS provider to continue:
                                </label>
                                <div className="projectSettingsRecordInfo">
                                  {dnsRecord ? (
                                    <>
                                      <p>
                                        Type
                                        <br /> <i>{dnsRecord.type}</i>
                                      </p>
                                      <p>
                                        Name
                                        <br /> <i>{dnsRecord.name}</i>
                                      </p>
                                      <p>
                                        Value
                                        <br /> <i>{dnsRecord.value}</i>
                                      </p>
                                    </>
                                  ) : (
                                    <p>No {selectedRecordType} record found for this domain.</p>
                                  )}
                                </div>
                              </div>
                            )}
                            {domainEditModes[domain.domainID] && (
                              <div
                                className="projectSettingsDomainContent"
                                style={{ justifyContent: "flex-start", alignItems: "center" }}
                              >
                                <label>
                                  Adjust the usage of this domain in your project:
                                </label>
                                <div className="projectSettingsDomainEditLine">
                                  <label>
                                    <p>Redirect to:</p>
                                  </label>
                                  <div className="projectSettingsDropdownWrapper">
                                    <button
                                      className="projectSettingsDomainButton"
                                      onClick={() => toggleRedirectDropdown(domain.domainID)}
                                      ref={(el) => (redirectButtonRefs.current[domain.domainID] = el)}
                                    >
                                      {domain.redirectTarget || "Redirect to..."}
                                      <FontAwesomeIcon
                                        icon={faCaretDown}
                                        className="projectSettingsDomainCaretIcon"
                                        style={{
                                          transform: redirectDropdownOpen[domain.domainID]
                                            ? "rotate(180deg)"
                                            : "rotate(0deg)",
                                          transition: "transform 0.3s ease",
                                        }}
                                      />
                                    </button>
                                    {redirectDropdownOpen[domain.domainID] && (
                                      <div
                                        className="projectSettingsDomainDropdownMenu"
                                        ref={(el) => (redirectDropdownRefs.current[domain.domainID] = el)}
                                        style={{
                                          top: (redirectDropdownPositions[domain.domainID]?.top || 0) * 1,
                                          left: redirectDropdownPositions[domain.domainID]?.left || 0,
                                        }}
                                      >
                                        <button onClick={() => handleRedirectSelect(domain.domainID, null)}>
                                          no redirect
                                          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                        </button>
                                        {domains
                                          .filter((d) => d.domainID !== domain.domainID)
                                          .map((d) => (
                                            <button
                                              key={d.domainID}
                                              onClick={() => handleRedirectSelect(domain.domainID, d.domainName)}
                                            >
                                              {d.domainName}
                                              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                            </button>
                                          ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="projectSettingsDomainEditLine">
                                  <label>
                                    <p>Environment:</p>
                                  </label>
                                  <div className="projectSettingsDropdownWrapper">
                                    <button
                                      className="projectSettingsDomainButton"
                                      onClick={() => toggleEnvironmentDropdown(domain.domainID)}
                                      ref={(el) => (environmentButtonRefs.current[domain.domainID] = el)}
                                    >
                                      {domain.environment || "Environment..."}
                                      <FontAwesomeIcon
                                        icon={faCaretDown}
                                        className="projectSettingsDomainCaretIcon"
                                        style={{
                                          transform: environmentDropdownOpen[domain.domainID]
                                            ? "rotate(180deg)"
                                            : "rotate(0deg)",
                                          transition: "transform 0.3s ease",
                                        }}
                                      />
                                    </button>
                                    {environmentDropdownOpen[domain.domainID] && (
                                      <div
                                        className="projectSettingsDomainDropdownMenu"
                                        ref={(el) => (environmentDropdownRefs.current[domain.domainID] = el)}
                                        style={{
                                          top: (environmentDropdownPositions[domain.domainID]?.top || 0) * 1,
                                          left: environmentDropdownPositions[domain.domainID]?.left || 0,
                                        }}
                                      >
                                        <button
                                          onClick={() => handleEnvironmentSelect(domain.domainID, "Production")}
                                        >
                                          Production
                                          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                        </button>
                                        <button
                                          onClick={() => handleEnvironmentSelect(domain.domainID, "Preview")}
                                        >
                                          Preview
                                          <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoaded && (
        <div
          className="projectSettingsCellHeaderContainer"
          style={{ justifyContent: "center", alignItems: "center", height: "100%" }}
        >
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title">Stack Forge</label>
          </div>
        </div>
      )}
    </div>
  );
};

export default StackForgeProjectSettings;