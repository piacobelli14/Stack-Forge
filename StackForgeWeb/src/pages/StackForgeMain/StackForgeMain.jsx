import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faPerson, faEye, faEyeSlash, faUserCircle, faPersonCirclePlus, faEnvelopeCircleCheck } from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthLogin.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth"; 

const StackForgeMain = () => {
    const navigate = useNavigate();
    const { setToken } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isEmail, setIsEmail] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [loginError, setLoginError] = useState("");
    const [screenSize, setScreenSize] = useState(window.innerWidth);

    return (
        <div className="loginPageWrapper" style={{"background": "linear-gradient(to left, #111111, #090011)", "display": screenSize >= 5300 ? "none" : ""}}>
            <StackForgeNav activePage="main" />


            <button> 
                Launch Website
            </button> 
        </div>
    );
};

export default StackForgeMain;