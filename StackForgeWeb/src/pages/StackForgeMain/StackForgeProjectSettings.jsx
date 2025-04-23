import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faUserGear, faUsersGear, faPersonChalkboard, faLock, faChartColumn, faMoneyBills, faGear, faBookmark, faPenToSquare, faClone, faSquareCheck, faGears } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgemainStyles/StackForgeProjectSettings.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

const StackForgeProjectSettings = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [settingsState, setSettingsState] = useState("general");
    const { project } = location.state || {};
    const [projectImage, setProjectImage] = useState(project?.image || "");
    const [projectName, setProjectName] = useState(project?.name || "");
    const [projectID, setProjectID] = useState(project?.project_id || ""); 
    const [domainName, setDomainName] = useState(project?.domain || ""); 
    const [editModes, setEditModes] = useState({
        projectName: false
    });

    const [projectIDCopied, setProjectIDCopied] = useState(false);

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoaded(true);
            } catch (error) { }
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


    const copyText = text => {
        navigator.clipboard.writeText(text);
    };

    const handleProjectImageChange = async e => {
        const file = e.target.files[0];
        if (!file) return await showDialog({ title: "Alert", message: "No file selected!" });
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result;
                try {
                    const token = localStorage.getItem("token");
                    if (!t) return;
                    const res = await fetch("http://localhost:3000/edit-project-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ userID, organizationID, projectID, image: base64Data })
                    });
                    if (!res.ok) return await showDialog({ title: "Alert", message: `Error uploading image: ${res.status} - ${await res.text()}` });
                    setProjectImage(base64Data);
                    e.target.value = "";
                } catch (uploadError) {
                    await showDialog({ title: "Alert", message: `Image upload failed: ${uploadError.message}` });
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
                body: JSON.stringify({ userID, organizationID, projectID, [fieldKey]: value })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            setEditModes(prev => ({ ...prev, [fieldKey]: false }));
        } catch (error) { }
    };

    const handleProjectDelete = async () => {
        const result = await showDialog({
            title: "Confirm Project Deletion",
            message: `Type 'delete my project - ${projectName}' to confirm deletion.`,
            inputs: [{ name: "confirmation", type: "text", defaultValue: "" }],
            showCancel: true
        });
        if (!result || result.confirmation !== `delete my project - ${projectName}`) {
            return;
        }
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/delete-project", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ userID, organizationID, projectID, projectName, domainName: projectName })
            });
            if (response.status !== 200) {
                throw new Error("Internal Server Error");
            } else {
                navigate("/stackforge");
            }
        } catch (error) {
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
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="projectSettingsCellHeaderContainer">
                    <div className="projectSettingsCellContentWrapper">
                        <div className="projectSettingsContentSideBar">
                            <div className="projectSettingsSideBarButtonWrapper">
                                <button className={"projectSettingsSideBarButton " + (settingsState === "general" ? "projectSettingsSideBarButton--selected" : "")} onClick={() => setSettingsState("general")}>
                                    <span>
                                        <FontAwesomeIcon icon={faGears} />
                                        General
                                    </span>
                                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </button>
                            </div>
                        </div>
                        <div className="projectsettingsContentMainFlex">
                            <div className="projectSettingsContentMainScroll">
                                {settingsState === "general" && (
                                    <>
                                        <div className="projectSettingsContentFlexCell">
                                            <div className="projectSettingsContentFlexCellTop">
                                                <div className="projectSettingsLeadingCellStack">
                                                    <h3>Project Picture</h3>
                                                    <p>
                                                        This is the picture associated with your project. It could be a logo, a screenshot, or just the image you want your project represented by.
                                                    </p>
                                                </div>
                                                <div className="projectSettingsTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <label className="projectSettingsUserImageWrapper" htmlFor="projectImageUpload" style={{ background: projectImage && projectImage !== "" ? "none" : "", boxShadow: projectImage && projectImage !== "" ? "none" : "" }}>
                                                        <img src={projectImage} className="projectSettingsUserImage" alt="" />
                                                    </label>
                                                    <input style={{ display: "none", padding: 0 }} type="file" id="projectImageUpload" accept="image/*" onChange={handleProjectImageChange} />
                                                </div>
                                            </div>
                                            <div className="projectSettingsContentFlexCellBottom">
                                                <p>A project image is not required, but if you don't select one, the Stackforge logo will be assigned to it.</p>
                                            </div>
                                        </div>

                                        <div className="projectSettingsContentFlexCell">
                                            <div className="projectSettingsContentFlexCellTop">
                                                <div className="projectSettingsLeadingCellStack">
                                                    <h3>Project Info</h3>
                                                    <p>
                                                        This is the name and project ID associated with your project. You can not change teh project ID assigned by Stackforge.
                                                    </p>
                                                </div>
                                                <div className="projectSettingsTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <div className="projectSettingsFieldInput">
                                                        <strong>Project Name</strong>
                                                        <span>
                                                            <input placeholder={project?.project_name} value={projectName} disabled={!editModes.projectName} onChange={e => setProjectName(e.target.value)} />
                                                            <button className="projectSettingsEditButton" onClick={() => editModes.projectName ? handleSaveProjectInfo("projectName", projectName) : setEditModes(prev => ({ ...prev, projectName: true }))}>
                                                                <FontAwesomeIcon icon={editModes.projectName ? faBookmark : faPenToSquare} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                    <div className="projectSettingsFieldInput">
                                                        <strong>Project ID</strong>
                                                        <span>
                                                            <input placeholder={projectID} disabled={true} />
                                                            <button className="projectSettingsEditButton" onClick={handleProjectIDCopy} style={{ opacity: projectIDCopied ? "0.6" : "1.0" }}>
                                                                <FontAwesomeIcon icon={projectIDCopied ? faSquareCheck : faClone} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="projectSettingsContentFlexCellBottom">
                                                <p>A project name is required.</p>
                                            </div>
                                        </div>

                                        <div className="profileContentFlexCell" style={{ border: "1px solid #E54B4B" }}>
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack" style={{ width: "100%" }}>
                                                    <h3>Delete Project</h3>
                                                    <p style={{ width: "100%" }}>Permanently delete this project and all of its contents from the platform. This is irreversible.</p>
                                                    <button className="profileDeleteButton" onClick={handleProjectDelete}>
                                                        Delete Project
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom" style={{ borderTop: "1px solid #E54B4B", backgroundColor: "rgba(229, 75, 75, 0.2)" }}>
                                                <p>This action is not reversible, so please continue with caution.</p>
                                            </div>
                                        </div>
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