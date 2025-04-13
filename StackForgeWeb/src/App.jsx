import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import Login from "./pages/StackForgeAuthentication/StackForgeAuthLogin"; 
import Register from "./pages/StackForgeAuthentication/StackForgeAuthRegister"; 
import Reset from "./pages/StackForgeAuthentication/StackForgeAuthReset";
import Verification from "./pages/StackForgeAuthentication/StackForgeAuthVerifyEmail";
import StackForgeMain from "./pages/StackForgeMain/StackForgeMain";
import StackForgeAddProjects from "./pages/StackForgeMain/StackForgeAddProjects";
import StackForgeImportProjects from "./pages/StackForgeMain/StackForgeImportProjects";
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
          <Route path="/stackforge" element={<StackForgeMain/>}/>
          <Route path="/add-new-project" element={<StackForgeAddProjects/>}/>
          <Route path="/import-new-project" element={<StackForgeImportProjects/>}/>
          <Route path="/add-new-domain" element={<StackForgeAddDomains/>}/>
          <Route path="/profile" element={<StackForgeProfile/>}/>
          <Route index element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
