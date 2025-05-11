import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faBarsStaggered,
  faCaretDown,
  faCircleInfo,
  faClock,
  faExclamationTriangle,
  faListUl,
  faRefresh,
  faSearch,
  faThLarge
} from "@fortawesome/free-solid-svg-icons";
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeRuntimeLogs.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import "../../styles/helperStyles/Checkbox.css";
import "../../styles/helperStyles/Tooltip.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

const StackForgeRuntimeLogs = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isTouchDevice = useIsTouchDevice();
  const { token, userID, loading, organizationID } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const [resizeTrigger, setResizeTrigger] = useState(false);
  const [logs, setLogs] = useState([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(true);
  const [isLevelOpen, setIsLevelOpen] = useState(true);
  const [timeFilters, setTimeFilters] = useState({
    past_30_mins: true,
    past_hour: false,
    past_day: false
  });
  const [levelFilters, setLevelFilters] = useState({
    Success: true,
    Warning: true,
    Error: true
  });
  const [statusFilters, setStatusFilters] = useState([]);
  const [hostFilters, setHostFilters] = useState([]);
  const [requestFilters, setRequestFilters] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const projectID = location.state?.projectID;
  const deploymentID = location.state?.deploymentID;

  const handleTimeFilterChange = key => {
    setTimeFilters({
      past_30_mins: key === "past_30_mins",
      past_hour: key === "past_hour",
      past_day: key === "past_day"
    });
  };

  const handleLevelFilterChange = (key, checked) => {
    setLevelFilters(prev => ({ ...prev, [key]: checked }));
  };
  const handleStatusFilterChange = (value, checked) => {
    setStatusFilters(prev =>
      checked ? [...prev, value] : prev.filter(v => v !== value)
    );
  };
  const handleHostFilterChange = (value, checked) => {
    setHostFilters(prev =>
      checked ? [...prev, value] : prev.filter(v => v !== value)
    );
  };
  const handleRequestFilterChange = (value, checked) => {
    setRequestFilters(prev =>
      checked ? [...prev, value] : prev.filter(v => v !== value)
    );
  };

  const resetAllFilters = () => {
    setTimeFilters({ past_30_mins: true, past_hour: false, past_day: false });
    setLevelFilters({ Success: true, Warning: true, Error: true });
    setStatusFilters([]);
    setHostFilters([]);
    setRequestFilters([]);
    setSearchQuery("");
  };

  useEffect(() => {
    if (!loading && !token) navigate("/login");
  }, [token, loading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      await fetchLogs();
      setIsLoaded(true);
    };
    if (!loading && token) fetchData();
  }, [userID, loading, token, timeFilters]);

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

  const fetchLogs = async () => {
    setIsFetchingLogs(true);
    try {
      const response = await fetch("http://localhost:3000/runtime-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          organizationID,
          userID,
          projectID,
          deploymentID,
          timePeriod:
            Object.keys(timeFilters).find(k => timeFilters[k]) ||
            "past_30_mins"
        })
      });
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setLogs(data.logs);
    } catch {
      setLogs([]);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const now = Date.now();
    const ts = new Date(log.timestamp).getTime();
    const timeMatches =
      (timeFilters.past_30_mins && now - ts <= 30 * 60 * 1000) ||
      (timeFilters.past_hour && now - ts <= 60 * 60 * 1000) ||
      (timeFilters.past_day && now - ts <= 24 * 60 * 60 * 1000);

    const statusCode = parseInt(log.status, 10) || 0;
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const isWarning = statusCode >= 300 && statusCode < 400;
    const isError = statusCode >= 400;
    const levelMatches =
      (isSuccess && levelFilters.Success) ||
      (isWarning && levelFilters.Warning) ||
      (isError && levelFilters.Error);

    const statusMatches =
      statusFilters.length === 0 || statusFilters.includes(log.status);
    const hostMatches =
      hostFilters.length === 0 || hostFilters.includes(log.host);
    const requestMatches =
      requestFilters.length === 0 ||
      requestFilters.includes(log.runtime_path);

    const searchLower = searchQuery.toLowerCase();
    const searchMatches =
      !searchQuery ||
      [log.status, log.host, log.runtime_path, log.runtime_messages]
        .some(f => String(f || "").toLowerCase().includes(searchLower));

    return (
      timeMatches &&
      levelMatches &&
      statusMatches &&
      hostMatches &&
      requestMatches &&
      searchMatches
    );
  });

  return (
    <div
      className="runtimeLogsPageWrapper"
      style={{
        background: "linear-gradient(to bottom, #322A54, #29282D)",
        display: screenSize >= 5300 ? "none" : ""
      }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && (
        <div className="runtimeLogsCellHeaderContainer">
          <div className="runtimeLogsTopBar">
            <div className="runtimeLogsTopBarSearchContainer">
              <div className="runtimeLogsSearchBarWrapper">
                <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                <input
                  type="text"
                  className="runtimeLogsSearchInput"
                  placeholder={`${filteredLogs.length} logs found...`}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <FontAwesomeIcon
                  icon={faCircleInfo}
                  className="runtimeLogsSearchIconSupplement"
                />
              </div>
            </div>
            <button
              className="runtimeLogsRefreshButton"
              onClick={fetchLogs}
              disabled={isFetchingLogs}
            >
              <FontAwesomeIcon icon={faRefresh} />
            </button>
          </div>

          <div className="runtimeLogsCellContentWrapper">
            <div className="runtimeLogsContentSideBar">
              <label
                className="runtimeLogsContentFilterHeader"
                onClick={() => setIsTimelineOpen(prev => !prev)}
              >
                <span>
                  <FontAwesomeIcon icon={faClock} />
                  Timeline
                </span>
                <FontAwesomeIcon
                  icon={faCaretDown}
                  style={{
                    transform: isTimelineOpen
                      ? "rotate(0deg)"
                      : "rotate(-180deg)",
                    transition: "transform 0.3s ease"
                  }}
                />
              </label>
              {isTimelineOpen && (
                <>
                  <div className="runtimeLogsContentDivider" />
                  <div className="runtimeLogsContentCheckboxStack">
                    <div className="runtimeLogsContentCheckboxWrapper">
                      <input
                        type="checkbox"
                        checked={timeFilters.past_30_mins}
                        className="stackforgeIDESettingsCheckbox"
                        onChange={() =>
                          handleTimeFilterChange("past_30_mins")
                        }
                      />
                      Past 30 Minutes
                    </div>
                    <div className="runtimeLogsContentCheckboxWrapper">
                      <input
                        type="checkbox"
                        checked={timeFilters.past_hour}
                        className="stackforgeIDESettingsCheckbox"
                        onChange={() => handleTimeFilterChange("past_hour")}
                      />
                      Past Hour
                    </div>
                    <div className="runtimeLogsContentCheckboxWrapper">
                      <input
                        type="checkbox"
                        checked={timeFilters.past_day}
                        className="stackforgeIDESettingsCheckbox"
                        onChange={() => handleTimeFilterChange("past_day")}
                      />
                      Past Day
                    </div>
                  </div>
                </>
              )}

              <label
                className="runtimeLogsContentFilterHeader"
                onClick={() => setIsLevelOpen(prev => !prev)}
              >
                <span>
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  Contains Level
                </span>
                <FontAwesomeIcon
                  icon={faCaretDown}
                  style={{
                    transform: isLevelOpen
                      ? "rotate(0deg)"
                      : "rotate(-180deg)",
                    transition: "transform 0.3s ease"
                  }}
                />
              </label>
              {isLevelOpen && (
                <>
                  <div className="runtimeLogsContentDivider" />
                  <div className="runtimeLogsContentCheckboxStack">
                    {["Success", "Warning", "Error"].map(level => (
                      <div
                        key={level}
                        className="runtimeLogsContentCheckboxWrapper"
                      >
                        <input
                          type="checkbox"
                          checked={levelFilters[level]}
                          className="stackforgeIDESettingsCheckbox"
                          onChange={e =>
                            handleLevelFilterChange(level, e.target.checked)
                          }
                        />
                        {level}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="runtimeLogsContentMainFlex" style={{"overflow": filteredLogs.length === 0 ? "hidden" : ""}}>
              <div className="runtimeLogsContainer">
                <div className="runtimeLogsHeader">
                  <div className="runtimeLogsHeaderCellMedium">Time</div>
                  <div className="runtimeLogsHeaderCellShort">Status</div>
                  <div className="runtimeLogsHeaderCellMedium">Host</div>
                  <div className="runtimeLogsHeaderCellMedium">Request</div>
                  <div className="runtimeLogsHeaderCellLong">Messages</div>
                </div>

                {filteredLogs.length === 0 ? (
                  <div className="runtimeLogsNoResults">

                    <div className="runtimeLogsNoResultCell">
                        <FontAwesomeIcon
                        icon={faListUl}
                        size="3x"
                        className="runtimeLogsNoResultsIcon"
                        />
                        <div className="runtimeLogsNoResultsText">
                        No logs found for the selected filters. 
                        </div>
                        <div className="runtimeLogsNoResultsButtons">
                        <button
                            className="runtimeLogsNoResultsReset"
                            onClick={resetAllFilters}
                        >
                            Reset Filters
                        </button>
                        <button
                            className="runtimeLogsNoResultsRefresh"
                            onClick={fetchLogs}
                            disabled={isFetchingLogs}
                        >
                            Refresh Logs
                        </button>
                        </div>
                    </div>
                  </div>
                ) : (
                  filteredLogs.map(log => {
                    const statusCode = parseInt(log.status, 10) || 0;
                    let statusColor;
                    if (statusCode >= 400) statusColor = "#E54B4B";
                    else if (statusCode >= 300) statusColor = "#E5B44B";
                    else if (statusCode >= 200) statusColor = "#5BBA6F";
                    else statusColor = "inherit";

                    const rowBorder =
                      statusCode >= 400
                        ? "1px solid rgba(229,75,75,0.2)"
                        : statusCode >= 300
                        ? "1px solid rgba(229,180,75,0.2)"
                        : statusCode >= 200
                        ? "1px solid rgba(91,186,111,0.2)"
                        : "transparent";
                    const rowBackgroundColor =
                      statusCode >= 400
                        ? "rgba(229,75,75,0.05)"
                        : statusCode >= 300
                        ? "rgba(229,180,75,0.05)"
                        : statusCode >= 200
                        ? "rgba(91,186,111,0.05)"
                        : "transparent";

                    return (
                      <div
                        key={log.build_log_id}
                        className="runtimeLogsEntry"
                        style={{
                          border: rowBorder,
                          backgroundColor: rowBackgroundColor
                        }}
                      >
                        <Tippy
                          content={new Date(log.timestamp).toLocaleTimeString()}
                          theme="tooltip-light"
                          arrow={false}
                        >
                          <div className="runtimeLogsEntryCellMedium">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </div>
                        </Tippy>
                        <Tippy
                          content={log.status || "—"}
                          theme="tooltip-light"
                          arrow={false}
                        >
                          <div
                            className="runtimeLogsEntryCellShort"
                            style={{ color: statusColor }}
                          >
                            {log.status || "—"}
                          </div>
                        </Tippy>
                        <Tippy
                          content={log.host || "—"}
                          theme="tooltip-light"
                          arrow={false}
                        >
                          <div className="runtimeLogsEntryCellMedium">
                            {log.host || "—"}
                          </div>
                        </Tippy>
                        <Tippy
                          content={log.runtime_path}
                          theme="tooltip-light"
                          arrow={false}
                        >
                          <div className="runtimeLogsEntryCellMedium">
                            {log.runtime_path}
                          </div>
                        </Tippy>
                        <Tippy
                          content={log.runtime_messages}
                          theme="tooltip-light"
                          arrow={false}
                        >
                          <div className="runtimeLogsEntryCellLong">
                            {log.runtime_messages}
                          </div>
                        </Tippy>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoaded && (
        <div
          className="projectDetailsCellHeaderContainer"
          style={{ justifyContent: "center" }}
        >
          <div className="loading-wrapper">
            <div className="loading-circle" />
            <label className="loading-title">Stack Forge</label>
          </div>
        </div>
      )}
    </div>
  );
};

export default StackForgeRuntimeLogs;
