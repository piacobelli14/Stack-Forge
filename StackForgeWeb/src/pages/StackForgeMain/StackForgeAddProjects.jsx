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
    faArrowRightArrowLeft
} from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeAddProjects.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import { showDialog } from "../../helpers/StackForgeAlert";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";

const StackForgeAddProject = () => {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [userDetails, setUserDetails] = useState({
        email: "",
        firstName: "",
        lastName: "",
        image: "",
        phone: "",
        role: "",
        isAdmin: "",
        twofaEnabled: false,
        multifaEnabled: false,
        loginNotis: false,
        exportNotis: false,
        dataSharing: false,
        gitID: "", 
        gitUsername: "", 
        gitImage: "",
        orgID: "",
        orgName: "",
        orgEmail: "",
        orgPhone: "",
        orgDesc: "",
        orgImage: "",
        orgCreated: ""
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [repositories, setRepositories] = useState([]);
    const filteredRepositories = repositories.filter(repo => repo.name.toLowerCase().includes(searchTerm.toLowerCase()));

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        const fetchData = async () => {
            await fetchUserInfo();
            await fetchRepos();
            setIsLoaded(true);
        };
        if (!loading && token) fetchData();
    }, [userID, loading, token]);

    useEffect(() => {
        const handleResize = () => {
            setIsLoaded(false);
            setScreenSize(window.innerWidth);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const fetchUserInfo = async id => {
        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/user-info", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` },
                body: JSON.stringify({ userID, organizationID })
            });
            if (res.status !== 200) throw new Error("Internal Server Error");
            const data = await res.json();
            const d = data[0];
            setUserDetails({
                email: d.email,
                firstName: d.firstname,
                lastName: d.lastname,
                image: d.image,
                phone: d.phone,
                role: d.role,
                isAdmin: d.isadmin,
                twofaEnabled: d.twofa,
                multifaEnabled: d.multifa,
                loginNotis: d.loginnotis,
                exportNotis: d.exportnotis,
                dataSharing: d.datashare,
                gitID: d.gitid, 
                gitUsername: d.gitusername,
                gitImage: d.gitimage, 
                orgID: d.orgid,
                orgName: d.organizationname,
                orgEmail: d.organizationemail,
                orgPhone: d.organizationphone,
                orgDesc: d.organizationdescription,
                orgImage: d.organizationimage,
                orgCreated: d.organizationcreated
            });
        } catch (e) {}
    };

    const fetchRepos = async () => {
        try {
            const t = localStorage.getItem("token");
            const res = await fetch("http://localhost:3000/git-repos", {
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${t}` }
            });
            if (res.status !== 200) throw new Error("Error fetching git repos");
            const data = await res.json();
            const formattedRepos = data.map(repo => ({
                name: repo.name,
                date: new Date(repo.updated_at).toLocaleDateString()
            }));
            setRepositories(formattedRepos);
        } catch (e) {}
    };

    return (
        <div
            className="addProjectsPageWrapper"
            style={{
                background: "linear-gradient(to bottom, #322A54, #29282D)",
                display: screenSize >= 5300 ? "none" : ""
            }}
        >
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="addProjectsCellHeaderContainer">
                    <div className="addProjectsFlexCellWrapper">
                        <div className="addProjectsFlexCell">
                            <div className="addProjectsCellHeader">
                                <div className="addprojectsCellTitleSupplement">
                                    <div className="importNewWrapper">
                                        <button className="importNewButton">
                                            <FontAwesomeIcon icon={faGithub} />
                                            {userDetails.gitUsername ? (
                                                <p>
                                                   @{userDetails.gitUsername || "Github"}
                                                </p>
                                            ) : (
                                                <p>
                                                   No GitHub profile associated with this account.
                                                </p>
                                            )}
                                        </button>
                                        <div className="importSearchBarWrapper">
                                            <FontAwesomeIcon icon={faSearch} className="importSearchIcon" />
                                            <input
                                                type="text"
                                                className="importSearchInput"
                                                placeholder="Search Repositories..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="addProjectsTopBarSearchContainer">
                                    </div>
                                </div>
                            </div>
                            <div className="addProjectsCellContent">
                                <div className="addProjectsContentListCellWrapper">
                                    {filteredRepositories.map((repo, index) => (
                                        <div className="repoItem" key={index}>
                                            <div className="repoNameDate">
                                                <p className="repoName">{repo.name}</p>
                                                <p className="repoDate">{repo.date}</p>
                                            </div>
                                            <button className="importButton" onClick={() => {navigate("/import-new-project", { state: { repository: `${userDetails.gitUsername}/${repo.name}`, personalName: userID, personalImage: userDetails.image, gitUsername: userDetails.gitUsername, gitID: userDetails.gitID, teamName: userDetails.orgName, teamImage: userDetails.orgImage } }); }}>Import</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="addProjectsFlexCell">
                            <div className="addProjectsCellHeader">
                                <p className="addProjectsCellTitle">
                                    Clone Template
                                </p>
                            </div>
                            <div className="addProjectsCellContent">
                                <div className="templateList">
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>Next.js Boilerplate</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>AI Chatbot</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>Commerce</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>Vite + React Starter</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>Commerce</p>
                                    </div>
                                    <div className="templateItem">
                                        <img src={"TestImage.png"} alt="Template" />
                                        <p>Vite + React Starter</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {!isLoaded && (
                <div className="addProjectsCellHeaderContainer" style={{ justifyContent: "center" }}>
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">Stack Forge</label>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StackForgeAddProject;
