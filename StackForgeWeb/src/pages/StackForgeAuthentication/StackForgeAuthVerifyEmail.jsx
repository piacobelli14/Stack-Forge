import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthVerifyEmail.css";

const VerifyEmail = () => {
  const [message, setMessage] = useState("Verifying...");
  const navigate = useNavigate();
  const location = useLocation();

  console.log("[VerifyEmail] render: ", { message, search: location.search });

  useEffect(() => {
    console.log("[VerifyEmail] useEffect firing");
    const verifyEmail = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");

      if (!token) {
        setMessage("Invalid verification link.");
        setTimeout(() => navigate("/login"), 3000);
        return;
      }

      try {
        const res = await fetch(`http://localhost:3000/verify-email?token=${token}`);
        console.log("[VerifyEmail] fetch status:", res.status);
        const data = await res.json();

        if (res.ok) {
          setMessage("Email verified successfully. Redirecting to login...");
          setTimeout(() => navigate("/login"), 2000);
        } else {
          setMessage(data.message || "Email verification failed. Redirecting to login...");
          setTimeout(() => navigate("/login"), 2000);
        }
      } catch (err) {
        console.error("[VerifyEmail] fetch error:", err);
        setMessage("An error occurred. Please try again later.");
        setTimeout(() => navigate("/login"), 2000);
      }
    };

    verifyEmail();
  }, [location.search, navigate]);

  return (
    <div
      className="verificationPageWrapper"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        className="verificationHeaderContainer"
        style={{ background: "linear-gradient(to bottom, #322A54, #29282D)" }}
      >
        <p
          style={{
            color: "#f5f5f5",
            fontWeight: 500,
            textAlign: "center",
            padding: "1rem",
          }}
        >
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title-supplement">Verifying...</label>
          </div>
        </p>
      </div>
    </div>
  );
};

export default VerifyEmail;
