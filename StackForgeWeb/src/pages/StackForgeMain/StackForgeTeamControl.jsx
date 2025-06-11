import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faPlusCircle, 
  faMailForward, 
  faCaretDown,
  faArrowDownAZ,
  faArrowDownZA,
  faListUl
} from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeTeamControl.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";
import { showDialog } from "../../helpers/StackForgeAlert";
import { faPlusSquare } from "@fortawesome/free-solid-svg-icons/faPlusSquare";

const StackForgeTeamControl = () => {
    const navigate = useNavigate(), isTouchDevice = useIsTouchDevice();
    const { token, userID, loading, organizationID } = useAuth();
    const [isLoaded, setIsLoaded] = useState(false);
    const [screenSize, setScreenSize] = useState(window.innerWidth);
    const [resizeTrigger, setResizeTrigger] = useState(false);
    const [teamPage, setTeamPage] = useState("manage");
    const [teamInvites, setteamInvites] = useState([{ email: "", first_name: "", last_name: "" }]);
    const [teamMembers, setTeamMembers] = useState([]);
    const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(false);
    const [accessRequests, setAccessRequests] = useState([]);
    const [isLoadingAccessRequests, setIsLoadingAccessRequests] = useState(false);
    const [selectedSort, setSelectedSort] = useState("A-Z");
    const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
    const sortSelectRef = useRef(null);
    const sortDropdownRef = useRef(null);
    const [sortDropdownPosition, setSortDropdownPosition] = useState({ top: 0, left: 0 });
    const [selectedPermission, setSelectedPermission] = useState("All Permissions");
    const [permissionDropdownOpen, setPermissionDropdownOpen] = useState(false);
    const permissionSelectRef = useRef(null);
    const permissionDropdownRef = useRef(null);
    const [permissionDropdownPosition, setPermissionDropdownPosition] = useState({ top: 0, left: 0 });
    const [openPermissionDropdown, setOpenPermissionDropdown] = useState(null);
    const rowPermSelectRef = useRef(null);
    const rowPermDropdownRef = useRef(null);
    const [rowPermDropdownPosition, setRowPermDropdownPosition] = useState({ top: 0, left: 0 });

    const filteredMembers = teamMembers.filter(m =>
        (selectedPermission === "All Permissions" ||
         (selectedPermission === "Admin" && m.is_admin === "admin") ||
         (selectedPermission === "Team Member" && m.is_admin === "member"))
    );
    const sortedMembers = [...filteredMembers].sort((a, b) => {
        if (selectedSort === "A-Z") {
            const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
            const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
            return nameA.localeCompare(nameB);
        } else if (selectedSort === "Z-A") {
            const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
            const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
            return nameB.localeCompare(nameA);
        }
    });

    useEffect(() => {
        if (!loading && !token) navigate("/login");
    }, [token, loading, navigate]);

    useEffect(() => {
        fetchTeamMembers();
        setIsLoaded(true);
    }, [userID, loading, token, organizationID]);

    useEffect(() => {
        if (teamPage === "requests" && !loading && token) {
            fetchAccessRequests();
        }
    }, [teamPage, userID, loading, token, organizationID]);

    useEffect(() => {
        const handleResize = () => {
            setIsLoaded(false);
            setScreenSize(window.innerWidth);
            setResizeTrigger(prev => !prev);
            setTimeout(() => setIsLoaded(true), 300);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                sortSelectRef.current &&
                !sortSelectRef.current.contains(event.target) &&
                sortDropdownRef.current &&
                !sortDropdownRef.current.contains(event.target)
            ) {
                setSortDropdownOpen(false);
            }
            if (
                permissionSelectRef.current &&
                !permissionSelectRef.current.contains(event.target) &&
                permissionDropdownRef.current &&
                !permissionDropdownRef.current.contains(event.target)
            ) {
                setPermissionDropdownOpen(false);
            }
            if (openPermissionDropdown && event.target.closest(".permissionDropdownWrapper") === null) {
                setOpenPermissionDropdown(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [openPermissionDropdown]);

    useEffect(() => {
        if (sortDropdownOpen && sortSelectRef.current && sortDropdownRef.current) {
            const buttonRect = sortSelectRef.current.getBoundingClientRect();
            const dropdownRect = sortDropdownRef.current.getBoundingClientRect();
            let newTop = buttonRect.bottom + 5;
            let newLeft = buttonRect.right - dropdownRect.width;
            if (newTop + dropdownRect.height > window.innerHeight) {
                newTop = window.innerHeight - dropdownRect.height;
            }
            if (newLeft < 0) {
                newLeft = 0;
            }
            setSortDropdownPosition({ top: newTop, left: newLeft });
        }
    }, [sortDropdownOpen]);

    useEffect(() => {
        if (permissionDropdownOpen && permissionSelectRef.current && permissionDropdownRef.current) {
            const buttonRect = permissionSelectRef.current.getBoundingClientRect();
            const dropdownRect = permissionDropdownRef.current.getBoundingClientRect();
            let newTop = buttonRect.bottom + 5;
            let newLeft = buttonRect.right - dropdownRect.width;
            if (newTop + dropdownRect.height > window.innerHeight) {
                newTop = window.innerHeight - dropdownRect.height;
            }
            if (newLeft < 0) {
                newLeft = 0;
            }
            setPermissionDropdownPosition({ top: newTop, left: newLeft });
        }
    }, [permissionDropdownOpen]);

    useEffect(() => {
        if (openPermissionDropdown && rowPermSelectRef.current && rowPermDropdownRef.current) {
            const buttonRect = rowPermSelectRef.current.getBoundingClientRect();
            const dropdownRect = rowPermDropdownRef.current.getBoundingClientRect();
            let newTop = buttonRect.bottom + 5;
            let newLeft = buttonRect.right - dropdownRect.width;
            if (newTop + dropdownRect.height > window.innerHeight) {
                newTop = window.innerHeight - dropdownRect.height;
            }
            if (newLeft < 0) {
                newLeft = 0;
            }
            setRowPermDropdownPosition({ top: newTop, left: newLeft });
        }
    }, [openPermissionDropdown]);

    const fetchTeamMembers = async () => {
        setIsLoadingTeamMembers(true);
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/team-members", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userID, organizationID })
            });

            const data = await response.json();
            setTeamMembers(data.teamMemberInfo);
            setIsLoadingTeamMembers(false);
        } catch (error) {}
    };

    const fetchAccessRequests = async () => {
        setIsLoadingAccessRequests(true);
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/team-members-access-requests", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userID, organizationID })
            });

            const data = await response.json();
            setAccessRequests(data.accessRequestsInfo);
            setIsLoadingAccessRequests(false);
        } catch (error) {}
    };

    const handleRequestResponse = async (requestUsername, action) => {
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/team-members-access-response", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userID, organizationID, requestUsername, action })
            });

            fetchAccessRequests();
            fetchTeamMembers();
        } catch (error) {
            showDialog("Error processing request. Please try again.");
        }
    };

    const handleRemove = async (memberUsername) => {
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("http://localhost:3000/remove-team-member", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userID, organizationID, memberUsername })
            });
            
            fetchTeamMembers();
        } catch (error) {}
    };

    const handlePermissionChange = async (username, isAdmin) => {
        try {
            const token = localStorage.getItem("token");
            await fetch("http://localhost:3000/team-members-permissions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userID, organizationID, username, is_admin: isAdmin })
            });
            setTeamMembers(prev =>
                prev.map(m => m.username === username ? { ...m, is_admin: isAdmin ? "admin" : "member" } : m)
            );
        } catch (error) {}
        setOpenPermissionDropdown(null);
    };

    return (
        <div className="teamPageWrapper" style={{ background: "linear-gradient(to bottom, #322A54, #29282D)", display: screenSize >= 5300 ? "none" : "" }}>
            <StackForgeNav activePage="main" />
            {isLoaded && (
                <div className="teamCellHeaderContainer">
                    <div className="projectsNavBar">
                        <button
                            style={{
                                borderBottom: teamPage === "manage" ? "2px solid #f5f5f5" : "none",
                                color: teamPage === "manage" ? "#f5f5f5" : ""
                            }}
                            onClick={() => setTeamPage("manage")}
                        >
                            Manage Team
                        </button>
                        <button
                            style={{
                                borderBottom: teamPage === "requests" ? "2px solid #f5f5f5" : "none",
                                color: teamPage === "requests" ? "#f5f5f5" : ""
                            }}
                            onClick={() => setTeamPage("requests")}
                        >
                            Access Requests
                        </button>
                    </div>

                    {teamPage === "manage" && (
                        <div
                            className="teamCellContentContainer"
                            onScroll={() => {
                                setSortDropdownOpen(false);
                                setPermissionDropdownOpen(false);
                                setOpenPermissionDropdown(null);
                            }}
                        >
                            <div className="teamContentFlexCell">
                                <div className="teamContentFlexCellTop">
                                    <p>Team Members</p>
                                    <div className="teamContentTopMenuWrapper">
                                        <div ref={permissionSelectRef} className="teamDropdownWrapper">
                                            <button
                                                className="teamDropdownButton"
                                                onClick={() => setPermissionDropdownOpen(prev => !prev)}
                                            >
                                                {selectedPermission}
                                                <FontAwesomeIcon
                                                    icon={faCaretDown}
                                                    className="addNewCaretIcon"
                                                    style={{
                                                        transform: permissionDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                                                        transition: "transform 0.3s ease"
                                                    }}
                                                />
                                            </button>
                                        </div>
                                        <div ref={sortSelectRef} className="teamDropdownWrapper">
                                            <button
                                                className="teamDropdownButton"
                                                onClick={() => setSortDropdownOpen(prev => !prev)}
                                            >
                                                {selectedSort}
                                                <FontAwesomeIcon
                                                    icon={faCaretDown}
                                                    className="addNewCaretIcon"
                                                    style={{
                                                        transform: sortDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                                                        transition: "transform 0.3s ease"
                                                    }}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {permissionDropdownOpen && (
                                    <div
                                        ref={permissionDropdownRef}
                                        className="teamDropdownMenu"
                                        style={{ top: permissionDropdownPosition.top, left: permissionDropdownPosition.left, zIndex: 1000 }}
                                    >
                                        <button onClick={() => { setSelectedPermission("All Permissions"); setPermissionDropdownOpen(false); }}>
                                            <i>All Permissions</i>
                                            <FontAwesomeIcon icon={faListUl} />
                                        </button>
                                        <button onClick={() => { setSelectedPermission("Admin"); setPermissionDropdownOpen(false); }}>
                                            <i>Admin</i>
                                            <FontAwesomeIcon icon={faListUl} />
                                        </button>
                                        <button onClick={() => { setSelectedPermission("Team Member"); setPermissionDropdownOpen(false); }}>
                                            <i>Team Member</i>
                                            <FontAwesomeIcon icon={faListUl} />
                                        </button>
                                    </div>
                                )}

                                {sortDropdownOpen && (
                                    <div
                                        ref={sortDropdownRef}
                                        className="teamDropdownMenu"
                                        style={{ top: sortDropdownPosition.top, left: sortDropdownPosition.left, zIndex: 1000 }}
                                    >
                                        <button onClick={() => { setSelectedSort("A-Z"); setSortDropdownOpen(false); }} style={{ justifyContent: "flex-start", gap: "0.4rem" }}>
                                            <FontAwesomeIcon icon={faArrowDownAZ} />
                                            <i>A-Z</i>
                                        </button>
                                        <button onClick={() => { setSelectedSort("Z-A"); setSortDropdownOpen(false); }} style={{ justifyContent: "flex-start", gap: "0.4rem" }}>
                                            <FontAwesomeIcon icon={faArrowDownZA} />
                                            <i>Z-A</i>
                                        </button>
                                    </div>
                                )}

                                <div className="teamContentFlexCellMedium" style={{ padding: 0 }}>
                                    {isLoadingTeamMembers ? (
                                        <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                            <div className="loading-circle" />
                                        </div>
                                    ) : (
                                        sortedMembers.length === 0 ? (
                                            <div className="teamNoResults">
                                                <div className="teamNoResultCell">
                                                    <div className="teamNoResultsText">
                                                        No team members found.
                                                    </div>
                                                    <div className="teamNoResultsButtons">
                                                        <button
                                                            className="teamNoResultsRefresh"
                                                            onClick={fetchAccessRequests}
                                                            disabled={isLoadingAccessRequests}
                                                        >
                                                            Refresh Requests
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            sortedMembers.map((member, i) => (
                                                <div key={i} className="teamContentMemberRow" style={{ height: sortedMembers.length === 1 ? "100%" : "auto", border: sortedMembers.length === 1 ? "none" : "" }}>
                                                    <div className="teamContentMemberRowLeading">
                                                        <img src={member.image || "TestImage.png"} />
                                                        <span>
                                                            <strong>
                                                                {member.first_name} {member.last_name}
                                                            </strong>
                                                            <p>
                                                                {member.email}
                                                            </p>
                                                        </span>
                                                    </div>
                                                    <div className="teamContentMemberRowTrailing">
                                                        <div className="permissionDropdownWrapper">
                                                            <button
                                                                ref={openPermissionDropdown === member.username ? rowPermSelectRef : null}
                                                                className="permissionDropdownButton"
                                                                disabled={member.username === userID}
                                                                style={member.username === userID ? { opacity: 0.6 } : {}}
                                                                onClick={() => setOpenPermissionDropdown(prev => prev === member.username ? null : member.username)}
                                                            >
                                                                {member.is_admin === "admin" ? "Admin" : "Team Member"}
                                                                <FontAwesomeIcon
                                                                    icon={faCaretDown}
                                                                    className="addNewCaretIcon"
                                                                    style={{
                                                                        transform: openPermissionDropdown === member.username ? "rotate(180deg)" : "rotate(0deg)",
                                                                        transition: "transform 0.3s ease"
                                                                    }}
                                                                />
                                                            </button>
                                                            {openPermissionDropdown === member.username && member.username !== userID && (
                                                                <div
                                                                    ref={rowPermDropdownRef}
                                                                    className="teamDropdownMenu"
                                                                    style={{
                                                                        position: "fixed",
                                                                        top: rowPermDropdownPosition.top,
                                                                        left: rowPermDropdownPosition.left,
                                                                        zIndex: 1000
                                                                    }}
                                                                >
                                                                    <button onClick={() => handlePermissionChange(member.username, true)}>
                                                                        Admin
                                                                        <FontAwesomeIcon icon={faListUl}/>
                                                                    </button>
                                                                    <button onClick={() => handlePermissionChange(member.username, false)}>
                                                                        Team Member
                                                                        <FontAwesomeIcon icon={faListUl}/>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            style={{
                                                                backgroundColor: "rgba(229, 75, 75, 0.1)",
                                                                border: "1px solid #E54B4B",
                                                                color: "#c1c1c1",
                                                            }}
                                                            onClick={() => handleRemove(member.username)}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )
                                    )}
                                </div>

                                <div className="teamContentFlexCellBottom">
                                    <p>Changes you make here will save automatically.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {teamPage === "requests" && (
                        <div className="teamCellContentContainer">
                            <div className="teamContentFlexCell">
                                <div className="teamContentFlexCellTop">
                                    <p>Access Requests</p>
                                    <div className="teamContentTopMenuWrapper"></div>
                                </div>
                                <div className="teamContentFlexCellMedium" style={{ padding: 0 }}>
                                    {isLoadingAccessRequests ? (
                                        <div className="loading-wrapper" style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                            <div className="loading-circle" />
                                        </div>
                                    ) : (
                                        accessRequests.length === 0 ? (
                                            <div className="teamNoResults">
                                                <div className="teamNoResultCell">
                                                    <div className="teamNoResultsText">
                                                        No current access requests.
                                                    </div>
                                                    <div className="teamNoResultsButtons">
                                                        <button
                                                            className="teamNoResultsRefresh"
                                                            onClick={fetchAccessRequests}
                                                            disabled={isLoadingAccessRequests}
                                                        >
                                                            Refresh Requests
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            accessRequests.map((req, i) => (
                                                <div key={i} className="teamContentMemberRow" style={{ height: accessRequests.length === 1 ? "100%" : "auto", border: accessRequests.length === 1 ? "none" : "" }}>
                                                    <div className="teamContentMemberRowLeading">
                                                        <img src={req.image || "TestImage.png"} />
                                                        <span>
                                                            <strong>
                                                                {req.first_name} {req.last_name}
                                                            </strong>
                                                            <p>
                                                                {req.email}
                                                            </p>
                                                        </span>
                                                    </div>
                                                    <div className="teamContentMemberRowTrailing">
                                                        <button onClick={() => handleRequestResponse(req.request_username, 'approve')}>
                                                            Confirm
                                                        </button>
                                                        <button
                                                            style={{
                                                                backgroundColor: "rgba(229, 75, 75, 0.1)",
                                                                border: "1px solid #E54B4B",
                                                                color: "#c1c1c1",
                                                            }}
                                                            onClick={() => handleRequestResponse(req.request_username, 'deny')}
                                                        >
                                                            Deny
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )
                                    )}
                                </div>
                                <div className="teamContentFlexCellBottom">
                                    <p>Changes you make here will save automatically.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!isLoaded && (
                <div className="teamCellHeaderContainer" style={{ justifyContent: "center" }}>
                    <div className="loading-wrapper">
                        <div className="loading-circle" />
                        <label className="loading-title">
                            Stack Forge
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StackForgeTeamControl;
