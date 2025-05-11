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
import "../../styles/mainStyles/StackForgeMainStyles/StackForgeBuildLogs.css";
import "../../styles/helperStyles/LoadingSpinner.css";
import "../../styles/helperStyles/Checkbox.css";
import "../../styles/helperStyles/Tooltip.css";
import StackForgeNav from "../../helpers/StackForgeNav";
import useAuth from "../../UseAuth";
import useIsTouchDevice from "../../TouchDevice.jsx";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

const StackForgeBuildLogs = () => {
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
      const response = await fetch("http://localhost:3000/build-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          organizationID,
          userID,
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

    const searchLower = searchQuery.toLowerCase();
    const searchMatches =
      !searchQuery ||
      [log.build_log_id, log.deployment_id, log.log_path, log.log_messages]
        .some(f => String(f || "").toLowerCase().includes(searchLower));

    return timeMatches && searchMatches;
  });

  return (
    <div
      className="buildLogsPageWrapper"
      style={{
        background: "linear-gradient(to bottom, #322A54, #29282D)",
        display: screenSize >= 5300 ? "none" : ""
      }}
    >
      <StackForgeNav activePage="main" />
      {isLoaded && (
        <div className="buildLogsCellHeaderContainer">
          <div className="buildLogsTopBar">
            <div className="buildLogsTopBarSearchContainer">
              <div className="buildLogsSearchBarWrapper">
                <FontAwesomeIcon icon={faSearch} className="searchIcon" />
                <input
                  type="text"
                  className="buildLogsSearchInput"
                  placeholder={`${filteredLogs.length} logs found...`}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <FontAwesomeIcon
                  icon={faCircleInfo}
                  className="buildLogsSearchIconSupplement"
                />
              </div>
            </div>
            <button
              className="buildLogsRefreshButton"
              onClick={fetchLogs}
              disabled={isFetchingLogs}
            >
              <FontAwesomeIcon icon={faRefresh} />
            </button>
          </div>

          <div className="buildLogsCellContentWrapper">
            <div className="buildLogsContentSideBar">
              <label
                className="buildLogsContentFilterHeader"
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
                  <div className="buildLogsContentDivider" />
                  <div className="buildLogsContentCheckboxStack">
                    <div className="buildLogsContentCheckboxWrapper">
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
                    <div className="buildLogsContentCheckboxWrapper">
                      <input
                        type="checkbox"
                        checked={timeFilters.past_hour}
                        className="stackforgeIDESettingsCheckbox"
                        onChange={() => handleTimeFilterChange("past_hour")}
                      />
                      Past Hour
                    </div>
                    <div className="buildLogsContentCheckboxWrapper">
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
            </div>

            <div className="buildLogsContentMainFlex" style={{ overflow: filteredLogs.length === 0 ? "hidden" : "" }}>
              <div className="buildLogsContainer">
                <div className="buildLogsHeader">
                  <div className="buildLogsHeaderCellMedium">Time</div>
                  <div className="buildLogsHeaderCellMedium">Deployment ID</div>
                  <div className="buildLogsHeaderCellLong">Path</div>
                  <div className="buildLogsHeaderCellLong">Messages</div>
                </div>

                {filteredLogs.length === 0 ? (
                  <div className="buildLogsNoResults">
                    <div className="buildLogsNoResultCell">
                      <FontAwesomeIcon
                        icon={faListUl}
                        size="3x"
                        className="buildLogsNoResultsIcon"
                      />
                      <div className="buildLogsNoResultsText">
                        No logs found for the selected filters.
                      </div>
                      <div className="buildLogsNoResultsButtons">
                        <button
                          className="buildLogsNoResultsReset"
                          onClick={resetAllFilters}
                        >
                          Reset Filters
                        </button>
                        <button
                          className="buildLogsNoResultsRefresh"
                          onClick={fetchLogs}
                          disabled={isFetchingLogs}
                        >
                          Refresh Logs
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  filteredLogs.map(log => (
                    <div
                      key={log.build_log_id}
                      className="buildLogsEntry"
                    >
                      <Tippy
                        content={new Date(log.timestamp).toLocaleTimeString()}
                        theme="tooltip-light"
                        arrow={false}
                      >
                        <div className="buildLogsEntryCellMedium">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </div>
                      </Tippy>

                      <Tippy
                        content={deploymentID}
                        theme="tooltip-light"
                        arrow={false}
                      >
                        <div className="buildLogsEntryCellMedium">
                          {deploymentID}
                        </div>
                      </Tippy>

                      <Tippy
                        content={log.log_path}
                        theme="tooltip-light"
                        arrow={false}
                      >
                        <div className="buildLogsEntryCellLong">
                          {log.log_path}
                        </div>
                      </Tippy>
                      <Tippy
                        content={log.log_messages}
                        theme="tooltip-light"
                        arrow={false}
                        placement="bottom"
                      >
                        <div className="buildLogsEntryCellLong">
                          {log.log_messages}
                        </div>
                      </Tippy>

                    </div>
                  ))
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

export default StackForgeBuildLogs;
