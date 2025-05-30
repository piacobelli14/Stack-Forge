import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthVerifyEmail.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMailBulk } from "@fortawesome/free-solid-svg-icons";

const VerifyEmail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const ranRef = useRef(false);
  const [message, setMessage] = useState("Verifying...");
  const [showRetry, setShowRetry] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
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

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    if (!token) {
      setShowRetry(true);
      return;
    }

    (async () => {
      try {
        const response = await fetch(
          `http://localhost:3000/verify-email?token=${token}`
        );
        const data = await response.json();

        if (response.status === 200) {
          navigate("/login");
        } else {
          setShowRetry(true);
        }
      } catch (error) {
        setShowRetry(true);
      }
    })();
  }, [location.search]);

  const handleResend = async () => {
    setResendMessage("");
    setResendLoading(true);
    try {
      const response = await fetch(
        "http://localhost:3000/resend-verification-email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: resendEmail }),
        }
      );
      const data = await response.json();
      setResendMessage(data.message || "Unable to resend. Please try again.");
      setResendStatus(true);
    } catch {
      setResendMessage("An error occurred. Please try again later.");
      setResendStatus(true);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div
      className="verificationPageWrapper"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="verificationHeaderContainer"
        style={{ background: "linear-gradient(to bottom, #322A54, #29282D)" }}
      >
        {!showRetry ? (
          <div className="loading-wrapper">
            <div className="loading-circle" />
          </div>
        ) : (
          <div className="unverifiedEmailCell" style={{ position: "relative" }}>
            <FontAwesomeIcon
              icon={faMailBulk}
              size="3x"
              className="unverifiedEmailIcon"
            />
            <div className="unverifiedEmailText">
              <strong>This token is either expired or invalid.</strong><br/>
              If you have successfully created account, you can request another verification email below.
            </div>
            <input
              className="unverifiedInputWrapper"
              type="email"
              placeholder="Enter your email to resend"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />
            <div className="unverifiedEmailButtons">
              {!resendStatus ? (
                <button
                  className="unverifiedEmailRefresh"
                  onClick={handleResend}
                >
                  Resend Verification Email
                </button>
              ) : (
                <div className="unverifiedEmailText" style={{ opacity: 0.8 }}>
                  {resendMessage}
                </div>
              )}
            </div>
            {resendLoading && (
              <div
                className="loading-wrapper"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: "100%",
                  height: "100%",
                  backgroundColor: "rgba(0,0,0,0.6)",
                }}
              >
                <div className="loading-circle" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
