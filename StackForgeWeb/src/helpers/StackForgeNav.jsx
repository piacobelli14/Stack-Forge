import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faXmark,
  faRightToBracket,
  faIdCard,
  faRightFromBracket,
  faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/helperStyles/NavBar.css";
import useAuth from "../UseAuth.jsx";
import useIsTouchDevice from "../TouchDevice.jsx";

const StackForgeNav = ({ activePage }) => {
  const navigate = useNavigate();
  const isTouchDevice = useIsTouchDevice();
  const { token, isAdmin, loading } = useAuth();
  const [isHamburger, setIsHamburger] = useState(false);
  const [isTokenExpired, setIsTokenExpired] = useState(false);

  useEffect(() => {
    const checkTokenExpiration = () => {
      if (token) {
        const decodedToken = decodeToken(token);
        if (decodedToken.exp * 1000 < Date.now()) {
          setIsTokenExpired(true);
        } else {
          setIsTokenExpired(false);
        }
      }
    };

    checkTokenExpiration();
  }, [token]);

  useEffect(() => {
    if (isHamburger) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isHamburger]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userid");
    localStorage.removeItem("orgid");
    navigate("/login");
  };

  const decodeToken = (token) => {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(jsonPayload);
    } catch (error) {
      return {};
    }
  };

  return (
    <div>
      <div className="homeHeaderContainer">
        <div className="homeTopNavBarContainer">
          <div className="homeSkipToContent">
            <img
              className="homeLogo"
              src="./StackForgeLogo.png"
              alt="Logo"
            />
            <label className="homeHeader" style={{ color: "#c0c0c0" }}>
              Stack Forge
            </label>
          </div>

          <div className="homeNavSupplement"></div>

          {!isTouchDevice && (
            <button
              className="homeHamburgerCircle"
              onClick={() => setIsHamburger(!isHamburger)}
            >
              <FontAwesomeIcon
                icon={isHamburger ? faXmark : faBars}
                className="homeHamburgerIcon"
                style={{ color: "white" }}
              />
            </button>
          )}
        </div>
      </div>

      {isHamburger && !isTouchDevice && (
        !isAdmin ? (
          <div
            className="homeHamburgerPopout"
          >
            <div className="homeHamburgerContent">      
              {!token && (
                <button
                  className="navigationButtonWrapper"
                  onClick={() => navigate("/register")}
                >
                  <div className="navigationButton" style={{ color: "white" }}>
                    <FontAwesomeIcon icon={faIdCard} className="navigationButtonIcon" />
                    Sign Up
                  </div>

                  <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="navigationButtonIconTrailer"
                  />
                </button>
              )}

              {!token ? (
                <button
                  className="navigationButtonWrapper"
                  onClick={() => navigate("/login")}
                >
                  <div className="navigationButton" style={{ color: "white" }}>
                    <FontAwesomeIcon
                      icon={faRightToBracket}
                      className="navigationButtonIcon"
                    />
                    Login
                  </div>

                  <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="navigationButtonIconTrailer"
                  />
                </button>
              ) : (
                <button className="navigationButtonWrapper" onClick={handleLogout}>
                  <div className="navigationButton" style={{ color: "#ced6dd" }}>
                    <FontAwesomeIcon
                      icon={faRightFromBracket}
                      className="navigationButtonIcon"
                    />
                    Sign Out
                  </div>

                  <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="navigationButtonIconTrailer"
                  />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="homeHamburgerPopout"
          >
            <div className="homeHamburgerContent">
              <button className="navigationButtonWrapper" onClick={() => navigate("/profile")}>
                <div className="navigationButton" style={{ color: "#ced6dd" }}>
                  <FontAwesomeIcon
                    icon={faIdCard}
                    className="navigationButtonIcon"
                  />
                  Account
                </div>

                <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="navigationButtonIconTrailer"
                  />
              </button>
              
              <button className="navigationButtonWrapper" onClick={handleLogout}>
                <div className="navigationButton" style={{ color: "#ced6dd" }}>
                  <FontAwesomeIcon
                    icon={faRightFromBracket}
                    className="navigationButtonIcon"
                  />
                  Sign Out
                </div>

                <FontAwesomeIcon
                      icon={faArrowUpRightFromSquare}
                      className="navigationButtonIconTrailer"
                  />
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default StackForgeNav;
