import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faEnvelope,
    faPerson,
    faEye,
    faEyeSlash,
    faUserCircle,
    faPersonCirclePlus,
    faEnvelopeCircleCheck,
    faKey
} from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthLogin.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";

const Login = () => {
    const navigate = useNavigate();
    const { setToken } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [twofaCode, setTwofaCode] = useState("");
    const [requires2fa, setRequires2fa] = useState(false);
    const [isEmail, setIsEmail] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [screenSize, setScreenSize] = useState(window.innerWidth);

    const handleLogin = async () => {
        try {
            const response = await fetch("http://localhost:3000/user-authentication", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: email,
                    password,
                }),
            });

            const data = await response.json();
            if (response.status === 200) {
                if (data.requires2fa) {
                    setRequires2fa(true);
                    setLoginError("");
                } else {
                    setToken(data.token);
                    if (data.isadmin === true) {
                        navigate("/stackforge");
                    } else {
                        navigate("/stackforge");
                    }
                }
            } else if (response.status === 429) {
                setLoginError("Too many login attempts. Please try again in 10 minutes.");
            } else {
                setLoginError(data.message);
            }
        } catch (error) {
            setLoginError("An error occurred. Please try again.");
        }
    };

    const handleVerifyCode = async () => {
        try {
            const response = await fetch("http://localhost:3000/user-authentication-verify", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: email,
                    code: twofaCode,
                }),
            });

            const data = await response.json();
            if (response.status === 200) {
                setToken(data.token);
                if (data.isadmin === true) {
                    navigate("/stackforge");
                } else {
                    navigate("/stackforge");
                }
            } else if (response.status === 429) {
                setLoginError("Too many attempts. Please try again later.");
            } else {
                setLoginError(data.message);
            }
        } catch (error) {
            setLoginError("An error occurred. Please try again.");
        }
    };

    return (
        <div
            className="loginPageWrapper"
            style={{
                background: "linear-gradient(to left, #111111, #090011)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="login" />
            <div
                className="loginCellHeaderContainer"
                style={{ background: "linear-gradient(to left, #111111, #090011)" }}
            >
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

                <div className="loginBlock">
                    <img
                        className="loginLogo"
                        src="./StackForgeLogo-Letters.png"
                        alt=""
                    />

                    <div className="loginInputWrapper">
                        <input
                            className="loginInput"
                            type="text"
                            placeholder={"Email Address or Username"}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={requires2fa}
                            style={{ opacity: requires2fa ? 0.6 : 1 }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !requires2fa) {
                                    setIsEmail(!isEmail);
                                }
                            }}
                        />
                    </div>

                    {!isEmail && !requires2fa && (
                        <button
                            className="loginInputButton"
                            style={{ backgroundColor: "#4E3270" }}
                            onClick={() => setIsEmail(!isEmail)}
                        >
                            <FontAwesomeIcon icon={faEnvelopeCircleCheck} className="envelopeIcon" />
                            <label className="loginInputText">Continue with Email</label>
                        </button>
                    )}

                    {!isEmail && !requires2fa && (
                        <button
                            className="loginInputButton"
                            style={{ backgroundColor: "#232729" }}
                            onClick={() => navigate("/register")}
                        >
                            <FontAwesomeIcon icon={faPersonCirclePlus} className="envelopeIcon" />
                            <label className="loginInputText">Create an Account</label>
                        </button>
                    )}

                    {!isEmail && !requires2fa && (
                        <button
                            className="loginSupplementalButton"
                            onClick={() => navigate("/reset")}
                        >
                            Forgot password?{" "}
                            <span style={{ color: "#D8C1F5", fontWeight: "800", opacity: "1" }}>
                                Click here to reset.
                            </span>
                        </button>
                    )}

                    {isEmail && !requires2fa && (
                        <div className="loginInputWrapper">
                            <input
                                className="loginInput"
                                type={passwordVisible ? "text" : "password"}
                                placeholder={"Password"}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleLogin();
                                    }
                                }}
                            />
                            <FontAwesomeIcon
                                icon={passwordVisible ? faEyeSlash : faEye}
                                onClick={() => setPasswordVisible(!passwordVisible)}
                                className="passwordToggleIcon"
                            />
                        </div>
                    )}

                    {isEmail && !requires2fa && (
                        <button
                            className="loginInputButton"
                            style={{ backgroundColor: "#4E3270" }}
                            onClick={handleLogin}
                        >
                            <label className="loginInputText">Sign In</label>
                        </button>
                    )}

                    {requires2fa && (
                        <div className="loginInputWrapper">
                            <input
                                className="loginInput"
                                type="text"
                                placeholder={"Enter 2FA Code"}
                                onChange={(e) => setTwofaCode(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleVerifyCode();
                                    }
                                }}
                            />
                            <FontAwesomeIcon
                                icon={faKey}
                                className="passwordToggleIcon"
                            />
                        </div>
                    )}

                    {requires2fa && (
                        <button
                            className="loginInputButton"
                            style={{ backgroundColor: "#4E3270" }}
                            onClick={handleVerifyCode}
                        >
                            <label className="loginInputText">Verify Code</label>
                        </button>
                    )}

                    <div className="loginError">{loginError}</div>

                    {requires2fa && (
                        <button
                            className="loginSupplementalButton"
                            style={{ textDecoration: "underline" }}
                            onClick={() => {
                                setRequires2fa(false);
                                setLoginError("");
                            }}
                        >
                            Return to Main
                        </button>
                    )}

                    {isEmail && !requires2fa && (
                        <button
                            className="loginSupplementalButton"
                            style={{ textDecoration: "underline" }}
                            onClick={() => {
                                setIsEmail(!isEmail);
                                setLoginError("");
                            }}
                        >
                            Return to Main
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Login;
