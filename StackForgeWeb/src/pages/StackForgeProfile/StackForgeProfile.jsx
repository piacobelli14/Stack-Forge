import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faUserGear, faUsersGear, faPersonChalkboard, faLock, faChartColumn, faMoneyBills, faGear, faBookmark, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeProfileStyles/StackForgeProfile.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import {showDialog} from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProfile = () => {
    const navigate = useNavigate(), isTouchDevice = useIsTouchDevice();
    const { token, userID, loading } = useAuth();
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
        dataSharing: false
    });
    const [editModes, setEditModes] = useState({
        firstName: false,
        lastName: false,
        email: false,
        phone: false,
        role: false
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

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                await fetchUserInfo(userID);
                setIsLoaded(true);
            } catch (error) { }
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

    const fetchUserInfo = async id => {
        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/user-info", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ userID: id })
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
                dataSharing: d.datashare
            });
        } catch (e) { }
    };

    const handleImageChange = async e => {
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

    const handleSave = async (fieldKey, value) => {
        const endpoints = {
            firstName: "edit-user-first-name",
            lastName: "edit-user-last-name",
            email: "edit-user-email",
            phone: "edit-user-phone",
            role: "edit-user-role"
        };
        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/" + endpoints[fieldKey], {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ userID, [fieldKey]: value })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            setEditModes(prev => ({ ...prev, [fieldKey]: false }));
        } catch (e) { }
    };

    const handleAccountDelete = async () => {
        const result = await showDialog({
          title: "Confirm Account Deletion",
          message: "Type 'delete my account' to confirm deletion.",
          inputs: [{ name: "confirmation", type: "text", defaultValue: "" }],
          showCancel: true,
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
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ userID }),
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
      
      



    return (
        <div className="profilePageWrapper" style={{ display: screenSize >= 5300 && screenSize < 700 ? "none" : "" }}>
            <StackForgeNav activePage="main" />
            <div className="profileCellHeaderContainer">
                <div className="profileCellContentWrapper">
                    <div className="profileContentSideBar">
                        <div className="profileSideBarButtonWrapper">
                            {settingsButtons.map(btn => (
                                <button key={btn.state} className="profileSideBarButton" onClick={() => setSettingsState(btn.state)}>
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
                                                <p>Your user profile image serves as your avatar. Click on it to upload a custom one.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <label className="profileUserImageWrapper" htmlFor="imageUpload">
                                                    <img src={userDetails.image} className="profileUserImage" alt="User profile" />
                                                </label>
                                                <input style={{ display: "none", padding: 0 }} type="file" id="imageUpload" accept="image/*" onChange={handleImageChange} />
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
                                                <p>Your first and last name as they will be displayed to other users.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>First Name</strong>
                                                    <span>
                                                        <input placeholder={userDetails.firstName} disabled={!editModes.firstName} onChange={e => setUserDetails(prev => ({ ...prev, firstName: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.firstName ? handleSave("firstName", userDetails.firstName) : setEditModes(prev => ({ ...prev, firstName: true }))}>
                                                            <FontAwesomeIcon icon={editModes.firstName ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>Last Name</strong>
                                                    <span>
                                                        <input placeholder={userDetails.lastName} disabled={!editModes.lastName} onChange={e => setUserDetails(prev => ({ ...prev, lastName: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.lastName ? handleSave("lastName", userDetails.lastName) : setEditModes(prev => ({ ...prev, lastName: true }))}>
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
                                                <p>The email address and phone number associated with your account. It won't be displayed to others.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Email Address</strong>
                                                    <span>
                                                        <input placeholder={userDetails.email} disabled={!editModes.email} onChange={e => setUserDetails(prev => ({ ...prev, email: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.email ? handleSave("email", userDetails.email) : setEditModes(prev => ({ ...prev, email: true }))}>
                                                            <FontAwesomeIcon icon={editModes.email ? faBookmark : faPenToSquare} />
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>Phone Number</strong>
                                                    <span>
                                                        <input placeholder={formatPhoneNumber(userDetails.phone)} disabled={!editModes.phone} onChange={e => setUserDetails(prev => ({ ...prev, phone: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.phone ? handleSave("phone", userDetails.phone) : setEditModes(prev => ({ ...prev, phone: true }))}>
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
                                                <p>Your position within the team. It does not influence your permissions.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Role</strong>
                                                    <span>
                                                        <input placeholder={userDetails.role} disabled={!editModes.role} onChange={e => setUserDetails(prev => ({ ...prev, role: e.target.value }))} />
                                                        <button className="profileEditButton" onClick={() => editModes.role ? handleSave("role", userDetails.role) : setEditModes(prev => ({ ...prev, role: true }))}>
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
                                                <p>This is the username you selected when you created your account.</p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>Username</strong>
                                                    <span>
                                                        <input placeholder={userID} disabled={true}/>
                                                        <button className="profileEditButton" style={{"opacity": 0.6}}>
                                                            <FontAwesomeIcon icon={faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>
                                               You cannot change this username. You can change your display name in the general settings tab. 
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profileContentFlexCell" style={{"border": "1px solid #E54B4B"}}>
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack" style={{"width": "100%"}}>
                                                <h3>Delete Account</h3>
                                                <p style={{"width": "100%"}}>
                                                    Permanently remove your Personal Account and all of its contents from the Vercel platform.
                                                   
                                                </p>

                                                <button className="profileActionButton" onClick={handleAccountDelete}> 
                                                    Delete Personal Account
                                                </button>
                                            </div>

                  
                                        </div>
                                        <div className="profileContentFlexCellBottom" style={{"border-top": "1px solid #E54B4B", "background-color": "rgba(229, 75, 75, 0.2)"}}>
                                            <p style={{"color": "white"}}>
                                            This action is not reversible, so please continue with caution. 
                                            </p>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StackForgeProfile;
