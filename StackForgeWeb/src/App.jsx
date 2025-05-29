import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import Login from "./pages/StackForgeAuthentication/StackForgeAuthLogin"; 
import Register from "./pages/StackForgeAuthentication/StackForgeAuthRegister"; 
import Reset from "./pages/StackForgeAuthentication/StackForgeAuthReset";
import Verification from "./pages/StackForgeAuthentication/StackForgeAuthVerifyEmail";
import StackForgeProjects from "./pages/StackForgeMain/StackForgeProjects";
import StackForgeProjectDetails from "./pages/StackForgeMain/StackForgeProjectDetails";
import StackForgeProjectSettings from "./pages/StackForgeMain/StackForgeProjectSettings";
import StackForgeUpdateDetails from "./pages/StackForgeMain/StackForgeUpdateDetails";
import StackForgeAddProject from "./pages/StackForgeMain/StackForgeAddProject";
import StackForgeBuildProject from "./pages/StackForgeMain/StackForgeBuildProject";
import StackForgeBuildLogs from "./pages/StackForgeMain/StackForgeBuildLogs";
import StackForgeRuntimeLogs from "./pages/StackForgeMain/StackForgeRuntimeLogs";
import StackForgeTeamControl from "./pages/StackForgeMain/StackForgeTeamControl"; 
import StackForgeProfile from "./pages/StackForgeProfile/StackForgeProfile";
import { useEffect, useState } from "react";

import "./styles/App.css";

function App() {
  const [osClass, setOsClass] = useState("");

  useEffect(() => {
    const detectOS = () => {
      const userAgent = navigator.userAgent;
      if (userAgent.indexOf("Win") !== -1) return "windows";
      if (userAgent.indexOf("Mac") !== -1) return "mac";
      return "";
    };
    setOsClass(detectOS());
  }, []);

  return (
    <Router>
      <div className={`App ${osClass}`}>
        <Routes>
          <Route path="/login"        element={<Login/>}/>
          <Route path="/register"     element={<Register/>}/>
          <Route path="/reset"        element={<Reset/>}/>
          <Route path="/verify-email" element={<Verification/>}/>
          <Route path="/verify"       element={<Verification/>}/>
          <Route path="/stackforge"   element={<StackForgeProjects/>}/>
          <Route path="/project-details"   element={<StackForgeProjectDetails/>}/>
          <Route path="/project-settings"  element={<StackForgeProjectSettings/>}/>
          <Route path="/update-details"     element={<StackForgeUpdateDetails/>}/>
          <Route path="/add-new-project"    element={<StackForgeAddProject/>}/>
          <Route path="/import-new-project" element={<StackForgeBuildProject/>}/>
          <Route path="/build-logs"         element={<StackForgeBuildLogs/>}/>
          <Route path="/runtime-logs"       element={<StackForgeRuntimeLogs/>}/>
          <Route path="/team-control"       element={<StackForgeTeamControl/>}/>
          <Route path="/profile"            element={<StackForgeProfile/>}/>
          <Route index element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
