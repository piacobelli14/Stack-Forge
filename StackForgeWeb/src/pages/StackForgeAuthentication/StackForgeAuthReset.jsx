import { useState, useEffect } from "react"; 
import { useNavigate } from "react-router-dom"; 
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faArrowRight, faEye, faEyeSlash, faPerson, faIdCard } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthReset.css"
import StackForgeNav from "../../helpers/StackForgeNav";


const Reset = () => {
    const navigate = useNavigate(); 

    const [isEmail, setIsEmail] = useState(true); 
    const [isCode, setIsCode] = useState(false);
    const [isReset, setIsReset] = useState(false); 
    const [newPassword, setNewPassword] = useState(""); 
    const [confirmPassword, setConfirmPassword] = useState(""); 
    const [newPasswordVisible, setNewPasswordVisible] = useState(false); 
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false); 

    const [resetError, setResetError] = useState(""); 

    const [resetEmail, setResetEmail] = useState(""); 
    const [resetCode, setResetCode] = useState(""); 
    const [checkedResetCode, setCheckedResetCode] = useState(""); 

    useEffect(() => {
        if (resetCode === checkedResetCode && resetCode !== "") {
          setIsCode(false);
          setIsReset(true);
        }
      }, [resetCode, checkedResetCode]);
    

      const handleEmail = async () => {
        try {
            setResetCode("xxx");
    
            const response = await fetch("http://172.20.10.2:3000/reset-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email: resetEmail }),
            });
    
            if (response.status === 200) {
                const jsonResponse = await response.json();
                const code = jsonResponse.data.resetCode;
                setCheckedResetCode(code);
                setIsEmail(false); 
                setIsCode(true); 
                setResetError(""); 
            } else if (response.status === 401) {
                setResetError("That email is not in our system.");
            } else {
                return;
            }
        } catch (error) {
            setResetError("An error occurred while trying to reset the password. Please try again later.");
        }
    };    
    
    const handlePassword = async () => {
        setResetError("");
    
        const hasUpperCase = /[A-Z]/.test(newPassword);
        const hasLowerCase = /[a-z]/.test(newPassword);
        const hasNumber = /\d/.test(newPassword);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>\-]/.test(newPassword);
        const isLengthValid = newPassword.length >= 8;
    
        if (!isLengthValid) {
            setResetError("Password must be at least 8 characters long.");
        } else if (!hasUpperCase) {
            setResetError("Password must contain at least 1 uppercase letter.");
        } else if (!hasLowerCase) {
            setResetError("Password must contain at least 1 lowercase letter.");
        } else if (!hasNumber) {
            setResetError("Password must contain at least 1 number.");
        } else if (!hasSpecialChar) {
            setResetError("Password must contain at least 1 special character.");
        } else if (newPassword !== confirmPassword) {
            setResetError("Passwords do not match.");
        } else {
            try {
                const response = await fetch("http://172.20.10.2:3000/change-password", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ newPassword, email: resetEmail }),
                });
    
                if (response.status === 200) {
                    navigate("/login");
                }
            } catch (error) {
                return;
            }
        }
    };

    return (
        <div className="resetPageWrapper">
            <StackForgeNav activePage="reset"/>
            <div className="resetCellHeaderContainer" style={{"background": "linear-gradient(to left, #111111, #090011)"}}> 
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

                <div className="resetBlock"> 
                    <img
                        className="loginLogo"
                        src="./StackForgeLogo-Letters.png"
                        alt="Logo"
                    />

                    {isEmail && (
                        <>
                            <div className="loginInputWrapper">
                                <input className="loginInput" placeholder={"Enter your email address..."} onChange={(e) => setResetEmail(e.target.value)} 
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            handleEmail();
                                        }
                                    }}
                                />
                            </div>
                        </>
                    )}
                    

                    {isEmail && (
                        
                        <button className="loginInputButton" onClick={handleEmail} style={{"margin": 0}}>
                            <label className="loginInputText">Continue</label>
                        </button>
                    )}

                    {isCode && (
                        <>
                        <div className="loginInputWrapper">
                            <input className="loginInput" placeholder={"Enter the code sent to your email address..."} onChange={(e) => setResetCode(e.target.value)}/>
                        </div>
                        </>
                    )}

                    {isReset && (
                        <>
                            <div className="passwordInputFlexLeading"> 
                                <input className="passwordInput" type={newPasswordVisible ? "text" : "password"} placeholder={"New Password"} onChange={(e) => setNewPassword(e.target.value)}/>
                                <FontAwesomeIcon
                                    icon={newPasswordVisible ? faEyeSlash : faEye}
                                    onClick={() => setNewPasswordVisible(!newPasswordVisible)}
                                    className="registerToggleIcon"
                                />
                            </div>

                            <div className="passwordInputFlex"> 
                                <input className="passwordInput" type={confirmPasswordVisible ? "text" : "password"} placeholder={"Confirm Password"} onChange={(e) => setConfirmPassword(e.target.value)}/>
                                <FontAwesomeIcon
                                    icon={confirmPasswordVisible ? faEyeSlash : faEye}
                                    onClick={() => setConfirmPasswordVisible(!confirmPasswordVisible)}
                                    className="registerToggleIcon"
                                />
                            </div>

                            <button className="loginInputButton" onClick={handlePassword} style={{"margin": 0}}>
                                <label className="loginInputText">Set New Password</label>
                            </button>
                        </>
                    )}
                    <div className="loginError">{resetError}</div>    
                </div>
            </div>
        </div>
    );
}; 

export default Reset; 