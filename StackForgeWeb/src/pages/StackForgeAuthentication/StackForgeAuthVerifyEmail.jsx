import {  Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../styles/mainStyles/StackForgeAuthenticationStyles/StackForgeAuthVerifyEmail.css"


const VerifyEmail = () => {
  const [message, setMessage] = useState("Verifying...");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const verifyEmail = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");

      if (!token) {
        setMessage("Invalid verification link.");
        setTimeout(() => {
          navigate("/login");
        }, 3000); 
        return;
      }

      try {
        const response = await fetch(`http://172.20.10.2:3000/verify-email?token=${token}`);
        const data = await response.json();

        if (response.status === 200) {
          setMessage("Email verified successfully. Redirecting to login...");
          setTimeout(() => {
            navigate("/login");
          }, 2000); 
        } else {
          setMessage(data.message || "Email verification failed. Redirecting to login...");
          setTimeout(() => {
            navigate("/login");
          }, 2000); 
        }
      } catch (error) {
        setMessage("An error occurred. Please try again later.");
        setTimeout(() => {
          navigate("/login");
        }, 2000); 
      }
    };

    verifyEmail();
  }, [location.search, navigate]);

  return (
    <div className="verificationPageWrapper">
        <div className="verificationHeaderContainer" style={{"background": "linear-gradient(to left, #111111, #090011)"}}>
            <p style={{"color": "#f5f5f5", "font-weight": "500", "text-align": "center"}}>{message}</p>
        </div>
    </div>
  );
};

export default VerifyEmail;