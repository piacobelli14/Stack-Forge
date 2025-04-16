import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import Login from "./pages/StackForgeAuthentication/StackForgeAuthLogin"; 
import Register from "./pages/StackForgeAuthentication/StackForgeAuthRegister"; 
import Reset from "./pages/StackForgeAuthentication/StackForgeAuthReset";
import Verification from "./pages/StackForgeAuthentication/StackForgeAuthVerifyEmail";
import StackForgeProjects from "./pages/StackForgeMain/StackForgeProjects";
import StackForgeProjectDetails from "./pages/StackForgeMain/StackForgeProjectDetails";
import StackForgeUpdateDetails from "./pages/StackForgeMain/StackForgeUpdateDetails";
import StackForgeAddProject from "./pages/StackForgeMain/StackForgeAddProject";
import StackForgeBuildProject from "./pages/StackForgeMain/StackForgeBuildProject";
import StackForgeAddDomains from "./pages/StackForgeMain/StackForgeAddDomains";
import StackForgeProfile from "./pages/StackForgeProfile/StackForgeProfile";
import { useEffect, useState } from "react";

import "./styles/App.css";

function App() {
  const [osClass, setOsClass] = useState("");

  useEffect(() => {
    const detectOS = () => {
      const userAgent = navigator.userAgent;
      if (userAgent.indexOf("Win") !== -1) {
        return "windows";
      } else if (userAgent.indexOf("Mac") !== -1) {
        return "mac";
      }
      return "";
    };

    const os = detectOS();
    setOsClass(os);
  }, []);

  return (
    <Router>
      <div className={`App ${osClass}`}>
        <Routes>
          <Route path="/login" element={<Login/>}/>
          <Route path="/register" element={<Register/>}/>
          <Route path="/reset" element={<Reset/>}/>
          <Route path="/verify" element={<Verification/>}/>
          <Route path="/stackforge" element={<StackForgeProjects/>}/>
          <Route path="/project-details" element={<StackForgeProjectDetails/>}/>
          <Route path="/update-details" element={<StackForgeUpdateDetails/>}/>
          <Route path="/add-new-project" element={<StackForgeAddProject/>}/>
          <Route path="/import-new-project" element={<StackForgeBuildProject/>}/>
          <Route path="/add-new-domain" element={<StackForgeAddDomains/>}/>
          <Route path="/profile" element={<StackForgeProfile/>}/>
          <Route index element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
