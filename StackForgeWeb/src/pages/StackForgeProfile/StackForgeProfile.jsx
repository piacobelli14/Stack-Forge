import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faArrowUpRightFromSquare, faUserGear, faUsersGear, faPersonChalkboard, faLock, faChartColumn, faMoneyBills, faGear } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeProfileStyles/StackForgeProfile.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth"; 
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeProfile = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const {token, userID, organizationID, loading } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false); 
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [settingsSearch, setSettingsSearch] = useState(""); 
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

    return (
        <div className="profilePageWrapper" style={{ display: screenSize >= 5300 && screenSize < 700 ? "none" : "" }}>
            <StackForgeNav activePage="main" />
            <div className="profileCellHeaderContainer">
                <div className="profileCellContentWrapper"> 
                    <div className="profileContentSideBar"> 
                        <div className="profileSodeBarSearchWrapper">
                            <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                            <input 
                                className="profileSideBarSearch"
                                type="text"
                                placeholder="Search..."
                                onChange={(e) => { setSettingsSearch(e.target.value) }}
                            />
                        </div>
                        <div className="profileSideBarButtonWrapper"> 
                            {settingsButtons
                                .filter(btn => btn.label.toLowerCase().includes(settingsSearch.toLowerCase()))
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
                        <div className="profileContentTopBar"> 
                            <h3> 
                                {capitalizeWords(currentSettingButton ? currentSettingButton.label : "")}
                            </h3> 
                        </div>
                        <div className="profileContentMainScroll">
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

                                </div>

                                <div className="profileContentFlexCellBottom"> 
                                    
                                </div>
                            </div> 
                            <div className="profileContentFlexCell">
                                <div className="profileContentFlexCellTop"> 

                                </div>

                                <div className="profileContentFlexCellBottom"> 
                                    
                                </div>    
                            </div> 
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StackForgeProfile;
