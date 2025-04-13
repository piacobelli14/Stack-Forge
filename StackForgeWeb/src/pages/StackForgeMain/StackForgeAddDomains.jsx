import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSearch,
    faThLarge,
    faList,
    faCaretDown,
    faCheck,
    faInfo,
    faKeyboard,
    faInfoCircle,
    faCircleInfo,
    faGrip,
    faSquare,
    faSquareArrowUpRight,
    faArrowUpRightFromSquare,
    faEllipsisV,
    faEllipsisH,
    faCodeBranch,
    faGlobe
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeAddDomains.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeAddDomains = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setIsLoaded(true);
            } catch (error) {
                console.error(error);
            }
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

    

    return (
        <div
            className="addDomainsPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="addDomainsCellHeaderContainer">

                    <div className="addDomainsFlexCell">
                        <div className="addDomainsStack">
                        <div className="addDomainsIcon"> 
                            <FontAwesomeIcon icon={faGlobe}/>
                        </div>

                        <strong>Add a domain.</strong>

                        <p>Add a domain that you can connect to your team's projects.</p>
                        </div>
                        <button className="addDomainButton">
                             Add existing domain.

                        </button>
                    </div>
                    
                </div>
            )}

            {!isLoaded && (
                <div className="addDomainsCellHeaderContainer" style={{ justifyContent: "center" }}>
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
            
        </div>
    );
};

export default StackForgeAddDomains;