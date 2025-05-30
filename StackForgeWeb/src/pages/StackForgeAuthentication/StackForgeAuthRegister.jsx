import { useEffect, useState } from "react"; 
import { useNavigate } from "react-router-dom"; 
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faArrowRight, faPerson, faEyeSlash, faEye, faListUl, faMailBulk } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthRegister.css"
import StackForgeNav from "../../helpers/StackForgeNav";
import { color } from "echarts";

const Register = () => {
    const navigate = useNavigate(); 
    const [isPersonal, setIsPersonal] = useState(true); 
    const [isPassword, setIsPassword] = useState(false); 
    const [isSuccess, setIsSuccess] = useState(false);
    const [firstName, setFirstName] = useState(""); 
    const [lastName, setLastName] = useState(""); 
    const [email, setEmail] = useState(""); 
    const [username, setUsername] = useState(""); 
    const [phone, setPhone] = useState("");
    const [profileImage, setProfileImage] = useState(null); 
    const [newPassword, setNewPassword] = useState(""); 
    const [confirmPassword, setConfirmPassword] = useState(""); 
    const [newPasswordVisible, setNewPasswordVisible] = useState(false); 
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false); 
    const [registerError, setRegisterError] = useState(""); 
    const [resendLoading, setResendLoading] = useState(false); 
    const [resendStatus, setResendStatus] = useState(false); 
    const [resendMessage, setResendMessage] = useState("");

    useEffect(() => {
        if (resendStatus) {
            const timer = setTimeout(() => {
                setResendStatus(false);
                setResendMessage("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [resendStatus]);

    const formatPhoneNumber = (value) => {
        const numericPhoneValue = value.replace(/\D/g, "");
        const formattedPhoneNumber = numericPhoneValue.replace(
          /^(\d{3})(\d{3})(\d{4})$/,
          "($1) $2-$3"
        );
        return formattedPhoneNumber;
    };

    const handleRegister = async () => {

        if (firstName !== "" && lastName !== "" && email !== "" && username !== "" && phone !== "") {
            if (!/\S+@\S+\.\S+/.test(email)) {
                setRegisterError("Please enter a valid email address.");
                return;
            }
        
            if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(phone)) {
                setRegisterError("Please enter a valid phone number in the format (XXX) XXX-XXXX.");
                return;
            }

            try {
                const response = await fetch("http://localhost:3000/validate-new-user-info", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email,
                        username,
                    }),
                });
        
                if (response.status === 200) {
                    setRegisterError(""); 
                    setIsPersonal(!isPersonal);
                    setIsPassword(!isPassword);
                } else {
                    setRegisterError("There is already an account associated with that email or username.");
                } 
            } catch (error) {
                return;
            }
        } else {
            setRegisterError("Please fill in all fields.")
        }
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProfileImage(file);
        }
    };
    
    const handlePassword = async () => {
        const hasUpperCase = /[A-Z]/.test(newPassword);
        const hasLowerCase = /[a-z]/.test(newPassword);
        const hasNumber = /\d/.test(newPassword);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>\-]/.test(newPassword);
        const isLengthValid = newPassword.length >= 8;
    
        if (!isLengthValid) {
            setRegisterError("Password must be at least 8 characters long.");
            return;
        } 
        if (!hasUpperCase) {
            setRegisterError("Password must contain at least 1 uppercase letter.");
            return;
        } 
        if (!hasLowerCase) {
            setRegisterError("Password must contain at least 1 lowercase letter.");
            return;
        } 
        if (!hasNumber) {
            setRegisterError("Password must contain at least 1 number.");
            return;
        } 
        if (!hasSpecialChar) {
            setRegisterError("Password must contain at least 1 special character.");
            return;
        } 
        if (newPassword !== confirmPassword) {
            setRegisterError("Passwords do not match.");
            return;
        } 
    
        const reader = new FileReader();
        reader.readAsDataURL(profileImage);
        reader.onload = async () => {
            const userData = {
                firstName,
                lastName,
                username,
                email,
                password: newPassword,
                phone,
                image: reader.result, 
            };
    
            try {
                const response = await fetch("http://localhost:3000/create-user", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(userData),
                });
    
                if (response.status === 200) {
                    setIsSuccess(true);
                } else {
                    const errorData = await response.json();
                    setRegisterError(errorData.message || "Registration failed; please try again later."); 
                }
            } catch (error) {
                setRegisterError("An error occurred while registering. Please try again later.");
            }
        };
        reader.onerror = () => {
            setRegisterError("Error reading the image file. Please try again.");
        };
    };

    const handleResend = async () => {
        setResendLoading(true);
        try {
            const response = await fetch("http://localhost:3000/resend-verification-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            if (response.status === 200) {
                setResendMessage("Verification email resent. Please check your inbox.");
                setResendStatus(true);
            } else {
                setResendMessage("Failed to resend verification email. Please try again later.");
                setResendStatus(true); 
            }
        } catch (error) {
            setResendMessage("An error occurred. Please try again later.");
            setResendStatus(true); 
        } finally {
            setResendLoading(false);
        }
    };

    return (
        <div className="registerPageWrapper">
            <StackForgeNav activePage="register"/>
            <div className="registerCellHeaderContainer" style={{"background": "linear-gradient(to left, #111111, #090011)"}}>
                <video
                    autoPlay
                    muted
                    loop
                    preload="auto"
                    id="animatedBackgroundEarth"
                    className="loginVideoBackground"
                >
                    <source src="/StackForgeBackground.mp4" type="video/mp4" />
                </video>
                
                {isSuccess ? (
                    <div className="registerBlock">
                        <img
                            className="resetLogo"
                            src="./StackForgeLogo-Letters.png"
                            alt=""
                        />
                        <div className="unverifiedEmailCell" style={{ position: "relative" }}>
                            <FontAwesomeIcon
                                icon={faMailBulk}
                                size="3x"
                                className="unverifiedEmailIcon"
                            />
                            <div className="unverifiedEmailText">
                                Please verify your email address. 
                                Once verified, <span className="loginLink" onClick={() => navigate("/login")}>click here to login.</span>
                            </div>
                            <div className="unverifiedEmailButtons">
                                {!resendStatus ? (
                                    <button
                                        className="unverifiedEmailRefresh"
                                        onClick={handleResend}
                                    >
                                        Resend Verification Email
                                    </button>
                                ) : (
                                    <div className="unverifiedEmailText" style={{"opacity": 0.8}}>
                                        {resendMessage}
                                    </div> 
                                )}
                            </div>
                            {resendLoading && (
                              <div className="loading-wrapper" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", "height": "100%", backgroundColor: "rgba(0,0,0,0.6)"  }}>
                                <div className="loading-circle" />
                              </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <>
                        {isPersonal && (
                            <div className="registerBlock">
                                <img
                                    className="registerLogo"
                                    src="./StackForgeLogo-Letters.png"
                                    alt=""
                                />

                                <div className="registerInputFlex">
                                    <div className="registerNameFlex" style={{"width": "100%", "height": "100%", "display": "flex", "justify-content": "space-between"}}> 
                                        <input className="registerNameInput"  placeholder={"First Name"} onChange={(e) => setFirstName(e.target.value)}/>
                                        <input className="registerNameInput"  placeholder={"Last Name"} onChange={(e) => setLastName(e.target.value)}/>
                                    </div>
                                </div>

                                <div className="registerInputFlex">
                                    <input className="registerInput" placeholder={"Email"} onChange={(e) => setEmail(e.target.value)}/>
                                </div>

                                <div className="registerInputFlex">
                                    <input className="registerInput" placeholder={"Phone"} value={phone} onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}/>
                                </div>
                                <div className="registerInputFlex">
                                    <input className="registerInput" placeholder={"Username"} onChange={(e) => setUsername(e.target.value)}/>
                                </div>

                                <div className="profilePictureUpload" style={{"backgroundColor": profileImage ? "#2D3436" : "rgba(255, 255, 255, 0.6)", "color": profileImage ? "white" : "#222222"}}>
                                    <label className="profileImageText" htmlFor="imageUpload">Choose a Photo</label>
                                    <input
                                        className="profilePicture"
                                        type="file"
                                        id="imageUpload"
                                        accept="image/*"
                                        onChange={handleImageChange}
                                        style={{"backgroundColor": profileImage ? "#2D3436" : "rgba(255, 255, 255, 0.9))"}}
                                    />
                                </div>
                                
                                <button className="loginInputButton" onClick={handleRegister} style={{"margin": "0"}}>    
                                    <label className="loginInputText">Continue</label>
                                </button>

                                <div className="loginError">{registerError}</div>
                            </div>
                        )}

                        {isPassword && (
                            <div className="registerBlock">
                                <img
                                    className="resetLogo"
                                    src="./StackForgeLogo-Letters.png"
                                    alt=""
                                />

                                <div className="passwordInputFlex"> 
                                    <input className="registerInput" type={newPasswordVisible ? "text" : "password"} placeholder={"New Password"} onChange={(e) => setNewPassword(e.target.value)}/>
                                    <FontAwesomeIcon
                                        icon={newPasswordVisible ? faEyeSlash : faEye}
                                        onClick={() => setNewPasswordVisible(!newPasswordVisible)}
                                        className="registerToggleIcon"
                                    />
                                </div>
                                
                                <div className="passwordInputFlex"> 
                                    <input className="registerInput" type={confirmPasswordVisible ? "text" : "password"} placeholder={"Confirm Password"} onChange={(e) => setConfirmPassword(e.target.value)}/>
                                    <FontAwesomeIcon
                                        icon={confirmPasswordVisible ? faEyeSlash : faEye}
                                        onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                                        className="registerToggleIcon"
                                    />
                                </div>
                            
                                <button className="loginInputButton" onClick={handlePassword} style={{"mrgin": 0}}>
                                    <label className="loginInputText">Create Account</label>
                                </button>

                                <div className="loginError">{registerError}</div>
                            </div>
                        )}
                    </>
                )}

                <video
                    autoPlay
                    muted
                    loop
                    preload="auto"
                    id="animatedBackgroundEarth"
                    style={{
                        position: "absolute",
                        width: "100vw",
                        height: "100%",
                        top: "0",
                        right: "0",
                        objectFit: "cover",
                        zIndex: "1",
                        pointerEvents: "none",
                    }}
                >
                    <source src="/StackForgeBackground.mp4" type="video/mp4" />
                </video>
            </div>
        </div>
    );
};

export default Register;
