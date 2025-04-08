import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faArrowUpRightFromSquare, faUserGear, faUsersGear, faPersonChalkboard, faLock, faChartColumn, faMoneyBills, faGear, faBookmark, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeProfileStyles/StackForgeProfile.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth"; 
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProfile = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, organizationID, loading } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false); 
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [settingsState, setSettingsState] = useState("general"); 
    const [organizationName, setOrganizationName] = useState(""); 
    const [organizgationUserCount, setOrganizationUserCount] = useState(0); 
    const [signinsData, setSigninsData] = useState([]); 

    const [isAdmin, setIsAdmin] = useState("");
    const [email, setEmail] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [image, setImage] = useState("");
    const [phone, setPhone] = useState("");
    const [role, setRole] = useState(""); 
    const [editModeFirstName, setEditModeFirstName] = useState(false);
    const [editModeLastName, setEditModeLastName] = useState(false);
    const [editModeEmail, setEditModeEmail] = useState(false);
    const [editModePhone, setEditModePhone] = useState(false);
    const [editModeRole, setEditModeRole] = useState(false); 
    const [twofaEnabled, setTwoFAEnabled] = useState(false); 
    const [multifaEnabled, setMultiFAEnabled] = useState(false); 
    const [loginNotis, setLoginNotis] = useState(false); 
    const [exportNotis, setExportNotis] = useState(false); 
    const [dataSharing, setDataSharing] = useState(false); 

    useEffect(() => {
        if (!loading && !token) {
            navigate("/login");
        }
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                await Promise.all([
                    fetchUserInfo(userID)
                ]);
                setIsLoaded(true); 
            } catch (error) {
                return;
            }
        };

        if (!loading && token) {
            fetchData();
        }
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

    const settingsButtons = [
        { state: "general", label: "general", icon: faGear },
        { state: "personal", label: "my account", icon: faUserGear },
        { state: "team", label: "my team", icon: faUsersGear },
        { state: "permissions", label: "permissions", icon: faPersonChalkboard },
        { state: "security", label: "security", icon: faLock },
        { state: "data", label: "data sharing", icon: faChartColumn },
        { state: "billing", label: "billing", icon: faMoneyBills },
    ];
    const capitalizeWords = (str) => { return str.replace(/\b\w/g, char => char.toUpperCase());};
    const currentSettingButton = settingsButtons.find(btn => btn.state === settingsState);

    const formatPhoneNumber = (value) => {
        const numericPhoneValue = value.replace(/\D/g, "");
        const formattedPhoneNumber = numericPhoneValue.replace(
          /^(\d{3})(\d{3})(\d{4})$/,
          "($1) $2-$3"
        );
        return formattedPhoneNumber;
    };

    const fetchUserInfo = async (userID) => {
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/user-info", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userID,
                }),
            });
    
            if (response.status !== 200) {
                throw new Error(`Internal Server Error`);
            }
    
            const data = await response.json();
            setEmail(data[0].email);
            setFirstName(data[0].firstname);
            setLastName(data[0].lastname);
            setImage(data[0].image);
            setPhone(data[0].phone);
            setRole(data[0].role);
            setIsAdmin(data[0].isadmin);
            setTwoFAEnabled(data[0].twofa);
            setMultiFAEnabled(data[0].multifa);
            setLoginNotis(data[0].loginnotis);
            setExportNotis(data[0].exportnotis);
            setDataSharing(data[0].datashare);
        } catch (error) {
            return;
        }
    };

    const handleImageChange = async (image) => {
        const file = image.target.files[0];
        if (!file) {
            alert("No file selected!");
            return;
        }
        try {
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Data = reader.result;
                setImage(base64Data);
                try {
                    const token = localStorage.getItem("token");
                    if (!token) {
                        return;
                    }
                    const response = await fetch("http://localhost:3000/edit-user-image", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`,
                        },
                        body: JSON.stringify({ userID, image: base64Data }),
                    });
                    if (!response.ok) {
                        const errorText = await response.text();
                        alert(`Error uploading image: ${response.status} - ${errorText}`);
                        return;
                    }
                    image.target.value = "";
                } catch (uploadError) {
                    alert(`Image upload failed: ${uploadError.message}`);
                }
            };
            reader.readAsDataURL(file);
        } catch (error) {
            alert(`An error occurred: ${error.message}`);
        }
    };

    const handleSave = async (fieldKey, value, setEditMode) => {
        const endpoints = {
            firstName: "edit-user-first-name",
            lastName: "edit-user-last-name",
            email: "edit-user-email",
            phone: "edit-user-phone",
            role: "edit-user-role"
        };
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/" + endpoints[fieldKey], {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                },
                body: JSON.stringify({ userID, [fieldKey]: value }),
            });
            if (response.status !== 200) {
                throw new Error(`Internal Server Error`);
            }
            setEditMode(false);
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
                            {settingsButtons
                                .map(btn => (
                                    <button key={btn.state} className="profileSideBarButton" onClick={() => { setSettingsState(btn.state) }}>
                                        <span>
                                            <FontAwesomeIcon icon={btn.icon} />
                                            {capitalizeWords(btn.label)}
                                        </span>
                                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                                    </button>
                                ))
                            }
                        </div>
                    </div>
                    <div className="profileContentMainFlex">
                        <div className="profileContentMainScroll">
                            {settingsState  === "general" && (
                                <>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>
                                                    Profile Picture
                                                </h3>
                                                <p>
                                                    This is your user profile image. It will serve as your avatar.
                                                    Click on the avatar to upload a custom one from your files.
                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <label className="profileUserImageWrapper" htmlFor="imageUpload">
                                                    <img src={image} className="profileUserImage" alt="User profile" />
                                                </label>
                                                <input
                                                    style={{ display: "none", padding: 0 }}
                                                    type="file"
                                                    id="imageUpload"
                                                    accept="image/*"
                                                    onChange={handleImageChange}
                                                />
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>
                                                A profile picture for your accountis required.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>
                                                    Personal Information
                                                </h3>
                                                <p>
                                                    This is your first and last name as they will be displayed to other users.

                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>
                                                        First Name
                                                    </strong>
                                                    <span>
                                                        <input placeholder={firstName} disabled={editModeFirstName ? false : true} onChange={(e)=>setFirstName(e.target.value)}/>
                                                        <button className="profileEditButton" onClick={editModeFirstName ? () => handleSave("firstName", firstName, setEditModeFirstName) : () => setEditModeFirstName(true)}>
                                                            <FontAwesomeIcon icon={editModeFirstName ? faBookmark : faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>
                                                        Last Name
                                                    </strong>
                                                    <span>
                                                        <input placeholder={lastName} disabled={editModeLastName ? false : true} onChange={(e)=>setLastName(e.target.value)}/>
                                                        <button className="profileEditButton" onClick={editModeLastName ? () => handleSave("lastName", lastName, setEditModeLastName) : () => setEditModeLastName(true)}>
                                                            <FontAwesomeIcon icon={editModeLastName ? faBookmark : faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>
                                            Your first and last name is required.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>
                                                    Contact Information
                                                </h3>
                                                <p>
                                                    This is the email address and phone number associated with this account.
                                                    It will not be displayed to other users.
                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>
                                                        Email Address
                                                    </strong>
                                                    <span>
                                                        <input placeholder={email} disabled={editModeEmail ? false : true} onChange={(e)=>setEmail(e.target.value)}/>
                                                        <button className="profileEditButton" onClick={editModeEmail ? () => handleSave("email", email, setEditModeEmail) : () => setEditModeEmail(true)}>
                                                            <FontAwesomeIcon icon={editModeEmail ? faBookmark : faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                                <div className="profileFieldInput">
                                                    <strong>
                                                        Phone Number
                                                    </strong>
                                                    <span>
                                                        <input placeholder={formatPhoneNumber(phone)} disabled={editModePhone ? false : true} onChange={(e)=>setPhone(e.target.value)}/>
                                                        <button className="profileEditButton" onClick={editModePhone ? () => handleSave("phone", phone, setEditModePhone) : () => setEditModePhone(true)}>
                                                            <FontAwesomeIcon icon={editModePhone ? faBookmark : faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>
                                            Your email address and phone number are required.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="profileContentFlexCell">
                                        <div className="profileContentFlexCellTop">
                                            <div className="profileLeadingCellStack">
                                                <h3>
                                                    Role
                                                </h3>
                                                <p>
                                                    This is the name of your position within your group or team. 
                                                    It does not influence your permissions. 
                                                </p>
                                            </div>
                                            <div className="profileTrailingCellStack" style={{ justifyContent: "center", alignItems: "center" }}>
                                                <div className="profileFieldInput">
                                                    <strong>
                                                        Role
                                                    </strong>
                                                    <span>
                                                        <input placeholder={role} disabled={editModeRole ? false : true} onChange={(e)=>setRole(e.target.value)}/>
                                                        <button className="profileEditButton" onClick={editModeRole ? () => handleSave("role", role, setEditModeRole) : () => setEditModeRole(true)}>
                                                            <FontAwesomeIcon icon={editModeRole ? faBookmark : faPenToSquare}/>
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="profileContentFlexCellBottom">
                                            <p>
                                                Assigning yourself a role is not required, but it is highly recommended. 
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
