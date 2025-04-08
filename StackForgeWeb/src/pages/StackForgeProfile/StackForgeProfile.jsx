import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faUserGear, faUsersGear, faPersonChalkboard, faLock, faChartColumn, faMoneyBills, faGear, faBookmark, faPenToSquare, faClone, faSquareCheck } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeProfileStyles/StackForgeProfile.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProfile = () => {
    const navigate = useNavigate(), isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [settingsState, setSettingsState] = useState("general");
    const [userDetails, setUserDetails] = useState({
        email: "",
        firstName: "",
        lastName: "",
        image: "",
        phone: "",
        role: "",
        isAdmin: "",
        twofaEnabled: false,
        multifaEnabled: false,
        loginNotis: false,
        exportNotis: false,
        dataSharing: false,
        orgid: "",
        orgName: "",
        orgEmail: "",
        orgPhone: "",
        orgDesc: "",
        orgImage: "",
        orgCreated: ""
    });
    const [editModes, setEditModes] = useState({
        firstName: false,
        lastName: false,
        email: false,
        phone: false,
        role: false, 
        orgName: false, 
        orgEmail: false, 
        orgPhone: false
    });
    const settingsButtons = [
        { state: "general", label: "general", icon: faGear },
        { state: "personal", label: "my account", icon: faUserGear },
        { state: "team", label: "my team", icon: faUsersGear },
        { state: "permissions", label: "permissions", icon: faPersonChalkboard },
        { state: "security", label: "security", icon: faLock },
        { state: "data", label: "data sharing", icon: faChartColumn },
        { state: "billing", label: "billing", icon: faMoneyBills }
    ];
    const capitalizeWords = str => str.replace(/\b\w/g, char => char.toUpperCase());
    const formatPhoneNumber = value => value.replace(/\D/g, "").replace(/^(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
    function formatDate(dateString) {
        const date = new Date(dateString);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const year = date.getFullYear();
        return month + '/' + day + '/' + year;
    }
    const copyText = (text) => {
        navigator.clipboard.writeText(text);
    };
    const [usernameCopied, setUsernameCopied] = useState(false);
    const [orgidCopied, setOrgidCopied] = useState(false);
    const [orgCreatedCopied, setOrgcreatedCopied] = useState(false);
    const [createTeamMessage, setCreateTeamMessage] = useState("");
    const [joinTeamMessage, setJoinTeamMessage] = useState("");
    const [createTeamError, setCreateTeamError] = useState("");
    const [joinTeamError, setJoinTeamError] = useState("");
    const [teamName, setTeamName] = useState("");
    const [teamCode, setTeamCode] = useState("");
    const [teamCreationLogout, setTeamCreationLogout] = useState(false);
    const [isTeamCreateLoad, setIsTeamCreateLoad] = useState(false);
    const [isTeamJoinLoad, setIsTeamJoinLoad] = useState(false);
    const [isPasswordLoad, setIsPasswordLoad] = useState(false);

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                await fetchUserInfo(userID);
                setIsLoaded(true);
            } catch (error) {}
        };
        if (!loading && token) fetchData();
    }, [userID, loading, token]);

    useEffect(() => {
        const handleResize = () => {
            setIsLoaded(false);
            setScreenSize(window.innerWidth);
            setResizeTrigger(prev => !prev);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (teamCreationLogout) {
            setIsLoaded(false);
            setTimeout(() => {
                localStorage.removeItem("token");
                localStorage.removeItem("userid");
                localStorage.removeItem("orgid");
                navigate("/login");
            }, 1200);
        }
    }, [teamCreationLogout]);

    useEffect(() => {
        if (createTeamMessage !== "") {
            setCreateTeamError("");
        }
    }, [createTeamMessage]);

    useEffect(() => {
        if (createTeamError !== "") {
            setCreateTeamMessage("");
        }
    }, [createTeamError]);

    useEffect(() => {
        if (joinTeamMessage !== "") {
            setJoinTeamError("");
        }
    }, [joinTeamMessage]);

    useEffect(() => {
        if (joinTeamError !== "") {
            setJoinTeamMessage("");
        }
    }, [joinTeamError]);

    const fetchUserInfo = async id => {
        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/user-info", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ userID: id, organizationID })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            const data = await res.json();
            const d = data[0];
            setUserDetails({
                email: d.email,
                firstName: d.firstname,
                lastName: d.lastname,
                image: d.image,
                phone: d.phone,
                role: d.role,
                isAdmin: d.isadmin,
                twofaEnabled: d.twofa,
                multifaEnabled: d.multifa,
                loginNotis: d.loginnotis,
                exportNotis: d.exportnotis,
                dataSharing: d.datashare,
                orgid: d.orgid,
                orgName: d.organizationname,
                orgEmail: d.organizationemail,
                orgPhone: d.organizationphone,
                orgDesc: d.organizationdescription,
                orgImage: d.organizationimage,
                orgCreated: d.organizationcreated
            });
        } catch (e) {}
    };

    const handleUserImageChange = async e => {
        const file = e.target.files[0];
        if (!file) return alert("No file selected!");
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result;
                setUserDetails(prev => ({ ...prev, image: base64Data }));
                try {
                    const t = localStorage.getItem("token");
                    if (!t) return;
                    const res = await fetch("http://localhost:3000/edit-user-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                        body: JSON.stringify({ userID, image: base64Data })
                    });
                    if (!res.ok) return alert(`Error uploading image: ${res.status} - ${await res.text()}`);
                    e.target.value = "";
                } catch (uploadError) {
                    alert(`Image upload failed: ${uploadError.message}`);
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            alert(`An error occurred: ${error.message}`);
        }
    };

    const handleTeamImageChange = async e => {
        const file = e.target.files[0];
        if (!file) return alert("No file selected!");
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result;
                setUserDetails(prev => ({ ...prev, orgImage: base64Data }));
                try {
                    const t = localStorage.getItem("token");
                    if (!t) return;
                    const res = await fetch("http://localhost:3000/edit-team-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                        body: JSON.stringify({ userID, organizationID, image: base64Data })
                    });
                    if (!res.ok) return alert(`Error uploading image: ${res.status} - ${await res.text()}`);
                    e.target.value = "";
                } catch (uploadError) {
                    alert(`Image upload failed: ${uploadError.message}`);
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            alert(`An error occurred: ${error.message}`);
        }
    };

    const handleSaveUserInfo = async (fieldKey, value) => {
        const endpoints = {
            firstName: "edit-user-first-name",
            lastName: "edit-user-last-name",
            email: "edit-user-email",
            phone: "edit-user-phone",
            role: "edit-user-role"
        };

        if (value === "" || !value) {
            return;
        }

        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/" + endpoints[fieldKey], {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ userID, [fieldKey]: value })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            setEditModes(prev => ({ ...prev, [fieldKey]: false }));
        } catch (e) {}
    };

    const handleSaveTeamInfo = async (fieldKey, value) => {
        const endpoints = {
            orgName: "edit-team-name", 
            orgEmail: "edit-team-email", 
            orgPhone: "edit-team-phone"
        };

        if (value === "" || !value) {
            return;
        }

        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/" + endpoints[fieldKey], {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ 
                    userID, 
                    organizationID, 
                    [fieldKey]: value
                })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            setEditModes(prev => ({ ...prev, [fieldKey]: false }));
            await fetchUserInfo(userID);
        } catch (e) {
            console.error("Error updating team name:", e);
        }
    };

    const handleAccountDelete = async () => {
        const result = await showDialog({
          title: "Confirm Account Deletion",
          message: "Type 'delete my account' to confirm deletion.",
          inputs: [{ name: "confirmation", type: "text", defaultValue: "" }],
          showCancel: true
        });
        if (!result || result.confirmation !== "delete my account") {
          return;
        }
        try {
          const token = localStorage.getItem("token");
          const response = await fetch("http://localhost:3000/delete-account", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ userID })
          });
          if (response.status !== 200) {
            throw new Error("Internal Server Error");
          } else {
            navigate("/login");
          }
        } catch (error) {
          return;
        }
    };

    const handleTeamCreation = async () => {
        setIsTeamCreateLoad(true);
        if (teamName === "" || !teamName) {
            setCreateTeamError("Please enter a valid team name.");
            setIsTeamCreateLoad(false);
            return;
        }
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/create-team", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ userID, teamName })
            });
            const data = await response.json();
            if (response.status === 200) {
                setCreateTeamMessage("Your new team has been created successfully!");
                setTeamCreationLogout(true);
                setTimeout(() => {
                    setIsTeamCreateLoad(false);
                }, 1000);
            } else {
                setCreateTeamError("That team name is either taken or invalid. Please select another.");
                setIsTeamCreateLoad(false);
            }
        } catch (error) {
            setCreateTeamError("An error occurred while creating the team. Please try again.");
            setIsTeamCreateLoad(false);
        }
    };

    const handleTeamJoin = async () => {
        setIsTeamJoinLoad(true);
        if (teamCode === "" || !teamCode) {
            setJoinTeamError("Please enter a valid access code.");
            setIsTeamJoinLoad(false);
            return;
        }

        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/join-team", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    userID, 
                    firstName: userDetails.firstName,  
                    lastName: userDetails.lastName, 
                    teamCode 
                })
            });
            if (response.status !== 200) {
                setJoinTeamError("There are no teams associated with that code. Please try again or contact your admin to get the correct code.");
                setIsTeamJoinLoad(false);
            } else if (response.status === 200) {
                setJoinTeamMessage("An access request has been sent to the appropriate administrators!");
                window.location.reload();
                setTimeout(() => {
                    setIsTeamJoinLoad(false);
                }, 1000);
            }
        } catch (error) {
            return;
        }
    };

    const handleUsernameCopy = () => {
        copyText(formatDate(userID));
        setUsernameCopied(true);
        setTimeout(() => setUsernameCopied(false), 2000);
    };

    const handleOrgidCopy = () => {
        copyText(userDetails.orgid);
        setOrgidCopied(true);
        setTimeout(() => setOrgidCopied(false), 2000);
    };

    const handleOrgCreatedCopy = () => {
        copyText(formatDate(userDetails.orgCreated));
        setOrgcreatedCopied(true);
        setTimeout(() => setOrgcreatedCopied(false), 2000);
    };

    return (
        <div className="profilePageWrapper" style={{ display: screenSize >= 5300 && screenSize < 700 ? "none" : "" }}>
            <StackForgeNav activePage="main" />
            <div className="profileCellHeaderContainer">
                <div className="profileCellContentWrapper">
                    <div className="profileContentSideBar">
                        <div className="profileSideBarButtonWrapper">
                            {settingsButtons.map(btn => (
                                <button key={btn.state} className={"profileSideBarButton " + (settingsState === btn.state ? "profileSideBarButton--selected" : "")} onClick={() => setSettingsState(btn.state)}>
                                    <span>
                                        <FontAwesomeIcon icon={btn.icon} /> {capitalizeWords(btn.label)}
                                    </span>
                                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="profileContentMainFlex">
                        <div className="profileContentMainScroll">
                            {settingsState === "general" && (
                                <>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>Profile Picture</h3>
                                                <p>
                                                    Your user profile image serves as your avatar. It is what other users will see you as.
                                                    Click on it to upload a custom one.
                                                
                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <label className="profileUserImageWrapper" htmlFor="userImageUpload">
                                                    <img src={userDetails.image} className="profileUserImage" alt="" />
                                                </label>
                                                <input style={{ display: "none", padding: 0 }} type="file" id="userImageUpload" accept="image/*" onChange={handleUserImageChange} />
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>A profile picture for your account is required.</p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>Personal Information</h3>
                                                <p>This is your first and last name as they will be displayed to other users.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>First Name</strong>
                                                    <span>
                                                        <input placeholder={userDetails.firstName} disabled={!editModes.firstName} onChange={e => setUserDetails(prev => ({ ...prev, firstName: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.firstName ? handleSaveUserInfo("firstName", userDetails.firstName) : setEditModes(prev => ({ ...prev, firstName: true }))}>
                                                            <FontAwesomeIcon icon={editModes.firstName ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>Last Name</strong>
                                                    <span>
                                                        <input placeholder={userDetails.lastName} disabled={!editModes.lastName} onChange={e => setUserDetails(prev => ({ ...prev, lastName: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.lastName ? handleSaveUserInfo("lastName", userDetails.lastName) : setEditModes(prev => ({ ...prev, lastName: true }))}>
                                                            <FontAwesomeIcon icon={editModes.lastName ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>Your first and last name is required.</p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>Contact Information</h3>
                                                <p>This is the email address and phone number associated with your account. It won't be displayed to others.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Email Address</strong>
                                                    <span>
                                                        <input placeholder={userDetails.email} disabled={!editModes.email} onChange={e => setUserDetails(prev => ({ ...prev, email: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.email ? handleSaveUserInfo("email", userDetails.email) : setEditModes(prev => ({ ...prev, email: true }))}>
                                                            <FontAwesomeIcon icon={editModes.email ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>Phone Number</strong>
                                                    <span>
                                                        <input placeholder={formatPhoneNumber(userDetails.phone)} disabled={!editModes.phone} onChange={e => setUserDetails(prev => ({ ...prev, phone: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.phone ? handleSaveUserInfo("phone", userDetails.phone) : setEditModes(prev => ({ ...prev, phone: true }))}>
                                                            <FontAwesomeIcon icon={editModes.phone ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>Your email address and phone number are required.</p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>Role</h3>
                                                <p>This is your self-described position or role. It is not related to your team and it does not influence your permissions.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Role</strong>
                                                    <span>
                                                        <input placeholder={userDetails.role} disabled={!editModes.role} onChange={e => setUserDetails(prev => ({ ...prev, role: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.role ? handleSaveUserInfo("role", userDetails.role) : setEditModes(prev => ({ ...prev, role: true }))}>
                                                            <FontAwesomeIcon icon={editModes.role ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>Assigning yourself a role is not required, but highly recommended.</p>
                                        </div>
                                    </div>
                                </>
                            )}
                            {settingsState === "personal" && (
                                <>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>Username</h3>
                                                <p>
                                                    This is the username you selected when you created your account.
                                                    This is what other users will see when they see you.
                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Username</strong>
                                                    <span>
                                                        <input placeholder={userID} disabled={true}/>
                                                        <button className="profileEditButton" onClick={handleUsernameCopy} style={{"opacity": usernameCopied ? "0.6" : "1.0"}}>
                                                            <FontAwesomeIcon icon={usernameCopied ? faSquareCheck : faClone}/>
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>You cannot change this username. You can change your display name in the general settings tab.</p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell" style={{ border: "1px solid #E54B4B" }}>
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack" style={{ width: "100%" }}>
                                                <h3>Delete Account</h3>
                                                <p style={{ width: "100%" }}>Permanently remove your Personal Account and all of its contents from the Vercel platform.</p>
                                                <button className="profileDeleteButton" onClick={handleAccountDelete}>
                                                    Delete Personal Account
                                                </button>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom" style={{ borderTop: "1px solid #E54B4B", backgroundColor: "rgba(229, 75, 75, 0.2)" }}>
                                            <p>This action is not reversible, so please continue with caution.</p>
                                        </div>
                                    </div>
                                </>
                            )}
                            {settingsState === "team" && (
                                !userDetails.orgid ? (
                                    <>
                                        <div className="profileContentFlexCell"  style={{ border: createTeamError !== "" ? "1px solid #E54B4B" : ""}}>
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Create a Team</h3>
                                                    <p>If you are not a aprt of a team or orgnaization, you can create one here. Just enter a team name and you will be given administrative access as the founder.</p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    {isTeamCreateLoad ? (
                                                        <div className="loading-circle" />
                                                    ) : (
                                                        <>
                                                            <div className="profileFieldInput">
                                                                <strong>Enter a Team Name</strong>
                                                                <span>
                                                                    <input placeholder={"New team name..."} onChange={e => setTeamName(e.target.value)}/>
                                                                </span>
                                                            </div>
                                                            <div className="profileFieldInput">
                                                                <span>
                                                                    <button className="profileActionButton" onClick={handleTeamCreation}>
                                                                        Create New Team
                                                                    </button>
                                                                </span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom" style={{ borderTop: createTeamError !== "" ? "1px solid #E54B4B" : "", backgroundColor: createTeamError !== "" ? "rgba(229, 75, 75, 0.2)" : "" }}>
                                                {(createTeamMessage === "" && createTeamError === "") && (
                                                    <p>Once you successfully create your team, you will be logged out. Once you sign back in you should see your team info.</p>
                                                )}
                                                {(createTeamError !== "") && (
                                                    <p>{createTeamError}</p>
                                                )}
                                                {(createTeamError === "" && createTeamMessage !== "") && (
                                                    <p>{createTeamError}</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCell" style={{ border: joinTeamError !== "" ? "1px solid #E54B4B" : ""}}>
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Join a Team</h3>
                                                    <p>If you need to join a team, your team administrator should have given you an access code. Once you have it you can enter it here to request access to the team.</p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    {isTeamJoinLoad ? (
                                                        <div className="loading-circle" />
                                                    ) : (
                                                        <>
                                                            <div className="profileFieldInput">
                                                                <strong>Enter Your Access Code</strong>
                                                                <span>
                                                                    <input placeholder={"Access code..."} onChange={e => setTeamCode(e.target.value)}/>
                                                                </span>
                                                            </div>
                                                            <div className="profileFieldInput">
                                                                <span>
                                                                    <button className="profileActionButton" onClick={handleTeamJoin}>
                                                                        Join Team
                                                                    </button>
                                                                </span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom" style={{ borderTop: joinTeamError !== "" ? "1px solid #E54B4B" : "", backgroundColor: joinTeamError !== "" ? "rgba(229, 75, 75, 0.2)" : "" }}>
                                                {(joinTeamMessage === "" && joinTeamError === "") && (
                                                    <p>Once you enter your access code, and access request will be sent to the team admins who can approve or deny your request.</p>
                                                )}
                                                {(joinTeamError !== "") && (
                                                    <p>{joinTeamError}</p>
                                                )}
                                                {(joinTeamError === "" && joinTeamMessage !== "") && (
                                                    <p>{joinTeamError}</p>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="profileContentFlexCell">
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Team Profile Picture</h3>
                                                    <p>
                                                        This is the image associated with your team. It is what other users will see when they look at your team. 
                                                    </p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <label className="profileUserImageWrapper" htmlFor="teamImageUpload">
                                                        <img src={userDetails.orgImage} className="profileUserImage" alt="" />
                                                    </label>
                                                    <input style={{ display: "none", padding: 0 }} type="file" id="teamImageUpload" accept="image/*" onChange={handleTeamImageChange} />
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom">
                                                <p>A team profile picture is not required but highly recommended.</p>
                                            </div>
                                        </div>

                                        <div className="profileContentFlexCell">
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Team Information</h3>
                                                    <p>This your team's Organization ID and date of creation. The Organization ID is the code that you will give to new users who need to access your team.</p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <div className="profileFieldInput">
                                                        <strong>Organization ID</strong>
                                                        <span>
                                                            <input placeholder={userDetails.orgid} disabled={true}/>
                                                            <button className="profileEditButton" onClick={handleOrgidCopy} style={{"opacity": orgidCopied ? "0.6" : "1.0"}}>
                                                                <FontAwesomeIcon icon={orgidCopied ? faSquareCheck : faClone}/>
                                                            </button>
                                                        </span>
                                                    </div>
                                                    <div className="profileFieldInput">
                                                        <strong>Created On</strong>
                                                        <span>
                                                            <input placeholder={formatDate(userDetails.orgCreated)}/>
                                                            <button className="profileEditButton" onClick={handleOrgCreatedCopy} style={{"opacity": orgCreatedCopied ? "0.6" : "1.0"}}>
                                                                <FontAwesomeIcon icon={orgCreatedCopied ? faSquareCheck : faClone} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom">
                                                <p>Neither of these fields can be changed.</p>
                                            </div>
                                        </div>

                                        <div className="profileContentFlexCell">
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Team Name</h3>
                                                    <p>This is the name of your team that other users will see when they look at your team's page.</p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <div className="profileFieldInput">
                                                        <strong>Team Name</strong>
                                                        <span>
                                                            <input placeholder={userDetails.orgName} disabled={!editModes.orgName} onChange={e => setUserDetails(prev => ({ ...prev, orgName: e.target.value }))} />
                                                            <button 
                                                                className="profileEditButton" 
                                                                onClick={() => editModes.orgName ? handleSaveTeamInfo("orgName", userDetails.orgName) : setEditModes(prev => ({ ...prev, orgName: true }))}
                                                            >
                                                                <FontAwesomeIcon icon={editModes.orgName ? faBookmark : faPenToSquare} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom">
                                                <p>Your team name can be changed, but we advise against it.</p>
                                            </div>
                                        </div>

                                        <div className="profileContentFlexCell">
                                            <div className="profileContentFlexCellTop">
                                                <div className="profileLeadingCellStack">
                                                    <h3>Team Contact Information</h3>
                                                    <p>This is the email address and phone number associated with your team. It won't be shared publically.</p>
                                                </div>
                                                <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                    <div className="profileFieldInput">
                                                        <strong>Email Address</strong>
                                                        <span>
                                                            <input placeholder={userDetails.orgEmail} disabled={!editModes.orgEmail} onChange={e => setUserDetails(prev => ({ ...prev, orgEmail: e.target.value }))} />
                                                            <button className="profileEditButton" onClick={() => editModes.orgEmail ? handleSaveTeamInfo("orgEmail", userDetails.orgEmail) : setEditModes(prev => ({ ...prev, orgEmail: true }))}>
                                                                <FontAwesomeIcon icon={editModes.orgEmail ? faBookmark : faPenToSquare} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                    <div className="profileFieldInput">
                                                        <strong>Phone Number</strong>
                                                        <span>
                                                            <input placeholder={formatPhoneNumber(userDetails.orgPhone)} disabled={!editModes.orgPhone} onChange={e => setUserDetails(prev => ({ ...prev, orgPhone: e.target.value }))} />
                                                            <button className="profileEditButton" onClick={() => editModes.orgPhone ? handleSaveTeamInfo("orgPhone", userDetails.orgPhone) : setEditModes(prev => ({ ...prev, orgPhone: true }))}>
                                                                <FontAwesomeIcon icon={editModes.orgPhone ? faBookmark : faPenToSquare} />
                                                            </button>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="profileContentFlexCellBottom">
                                                <p>Your team's email address and phone number are not rewuired, but they are highly recommended.</p>
                                            </div>
                                        </div>
                                    </>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StackForgeProfile;
