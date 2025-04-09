import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthLogin.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeMain = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);


    return (
        <div className="loginPageWrapper" style={{ background: "linear-gradient(to bottom, #0E0B1B, #29282D)", display: screenSize >= 5300 ? "none" : "" }}>
            <StackForgeNav activePage="main" />


        </div>
    );
};

export default StackForgeMain;
