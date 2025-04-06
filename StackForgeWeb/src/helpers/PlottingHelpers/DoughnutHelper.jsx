import { useEffect, useState, useRef, useCallback } from "react";
import ReactEcharts from "echarts-for-react";
import useAuth from "../../UseAuth.jsx";
import PropTypes from 'prop-types'; 

const DoughnutPlot = ({ cellType, data, organizationName, fontSizeMultiplier }) => {
  const { token, userID, organizationID, loading } = useAuth();
  const [screenSize, setScreenSize] = useState(window.innerWidth);

  const getResponsiveOptions = (size) => {
    if (size < 499) {
      return {
        fontSize: 0,
        grid: { left: 0, right: 0, bottom: 0, top: 0 },
        lineWidth: 0,
        symbolSize: 0,
        gridLineWidth: 0,
        tooltipFontSize: 0,
        border: 0,
      };
    } else if (size >= 500 && size <= 699) {
      return {
        fontSize: 8,
        grid: { left: 30, right: 30, bottom: 10, top: 15, containLabel: true },
        lineWidth: 2,
        symbolSize: 9,
        gridLineWidth: 1,
        tooltipFontSize: 8,
        border: 2,
      };
    } else if (size >= 700 && size <= 1299) {
      return {
        fontSize: 12,
        grid: { left: 30, right: 30, bottom: 50, top: 40, containLabel: true },
        lineWidth: 3.5,
        symbolSize: 10,
        gridLineWidth: 2,
        tooltipFontSize: 12,
        border: 3.5,
      };
    } else if (size >= 1300 && size <= 1699) {
      return {
        fontSize: 14,
        grid: { left: 80, right: 80, bottom: 60, top: 60 },
        lineWidth: 4,
        symbolSize: 11,
        gridLineWidth: 2.5,
        tooltipFontSize: 14,
        border: 4.5,
      };
    } else if (size >= 1700 && size <= 2199) {
      return {
        fontSize: 16,
        grid: { left: 80, right: 80, bottom: 70, top: 70 },
        lineWidth: 5,
        symbolSize: 13,
        gridLineWidth: 3.5,
        tooltipFontSize: 16,
        border: 0,
      };
    } else if (size >= 2200 && size <= 2599) {
      return {
        fontSize: 22,
        grid: { left: 100, right: 100, bottom: 100, top: 80 },
        lineWidth: 6,
        symbolSize: 20,
        gridLineWidth: 4.5,
        tooltipFontSize: 22,
        border: 8.5,
      };
    } else if (size >= 2600 && size <= 3899) {
      return {
        fontSize: 34,
        grid: { left: 140, right: 140, bottom: 160, top: 140 },
        lineWidth: 10,
        symbolSize: 25,
        gridLineWidth: 6,
        tooltipFontSize: 34,
        border: 11.5,
      };
    } else if (size >= 3900 && size <= 5299) {
      return {
        fontSize: 42,
        grid: { left: 140, right: 140, bottom: 220, top: 220 },
        lineWidth: 14,
        symbolSize: 32,
        gridLineWidth: 8,
        tooltipFontSize: 42,
        border: 12.5,
      };
    } else {
      return {
        fontSize: 0,
        grid: { left: 0, right: 0, bottom: 0, top: 0 },
        lineWidth: 0,
        symbolSize: 0,
        gridLineWidth: 0,
        tooltipFontSize: 0,
        border: 0,
      };
    }
  };

  useEffect(() => {
    const handleResize = () => setScreenSize(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const AnimatedPieChart = ({ data, chartType, chartName, colors, fontSizeMultiplier }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [visible, setVisible] = useState(true);
    const [currentValue, setCurrentValue] = useState(data[0]?.value || 0);
    const { fontSize, tooltipFontSize, grid, border } = getResponsiveOptions(screenSize);
    const chartRef = useRef(null);
    const prevIndexRef = useRef(0);

    const displayDuration = 2000;
    const fadeDuration = 500;

    useEffect(() => {
      if (!data || data.length === 0) return;

      if (data.length < 2) {
        setCurrentValue(data[0]?.value || 0);
        return;
      }

      const interval = setInterval(() => {
        setVisible(false);

        setTimeout(() => {
          const newIndex = (activeIndex + 1) % data.length;
          setActiveIndex(newIndex);
          setCurrentValue(data[newIndex]?.value || 0);

          if (chartRef.current) {
            chartRef.current.getEchartsInstance().dispatchAction({
              type: "highlight",
              seriesIndex: 0,
              dataIndex: newIndex,
            });

            chartRef.current.getEchartsInstance().dispatchAction({
              type: "downplay",
              seriesIndex: 0,
              dataIndex: prevIndexRef.current,
            });

            prevIndexRef.current = newIndex;
          }

          setVisible(true);
        }, fadeDuration);
      }, displayDuration);

      if (chartRef.current) {
        chartRef.current.getEchartsInstance().dispatchAction({
          type: "highlight",
          seriesIndex: 0,
          dataIndex: activeIndex,
        });
        prevIndexRef.current = activeIndex;
      }

      return () => clearInterval(interval);
    }, [activeIndex, data, displayDuration, fadeDuration]);

    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          const hoveredColor = params.color;
          const value = typeof params.value === 'number' && !Number.isInteger(params.value) ? params.value.toFixed(2) : params.value;
          return `
                <div className="tooltipWrapper" style="color: white; padding: 0; background-color: rgba(24,24,24,0.95); padding: 1vw; border: 2px solid #222832; border-radius: 0.4vw;">
                    <div style="font-weight: bold; font-size: 1.2vw; color: rgba(255,255,255,0.9);">${params.name}</div>
                    <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.6); width: 100%; margin: 1vw 0;">
                    <div style="color: ${hoveredColor};">Count: <b style="color: white;">${value}</b></div>
                </div>`;
        },
        backgroundColor: "rgba(255,255,255,0.0)",
        borderColor: "rgba(255,255,255,0.0)",
        padding: 0,
        textStyle: {
          color: "#ffffff",
          fontSize: tooltipFontSize,
        },
      },
      series: [
        {
          name: chartName,
          type: "pie",
          radius: ["45%", "85%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: border * 1.5,
            borderColor: "#131313",
            borderWidth: border,
          },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: {
              shadowBlur: border * 20,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 1.0)",
            },
          },
          label: {
            show: false,
          },
          labelLine: {
            show: false,
          },
          data: data,
          color: ["#2ecc71", "#148444", "#0F6340", "#208BB9", "#2042B9", "#3520B9", "#6320B9", "#9120B9",],
        },
      ],
      grid:  {
        ...grid,
      },
    };

    const adjustedFontSize = fontSize * fontSizeMultiplier;

    const overlayStyle = {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      color: "#C0C0C0",
      fontSize: adjustedFontSize,
      fontWeight: "bold",
      textAlign: "center",
      opacity: visible ? 1 : 0,
      transition: `opacity ${fadeDuration}ms ease-in-out`,
      pointerEvents: "none",
    };

    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <ReactEcharts
          option={option}
          style={{
            width: "100%",
            height: "100%",
            maxHeight: "100%",
            overflow: "visible",
          }}
          ref={chartRef}
        />
        <div style={overlayStyle}>{currentValue}</div>
      </div>
    );
  };

  const renderPlots = (data, chartType) => {
    let chartData;
    let colors;
    let chartName = "Data Distribution";

    let rawData;
    if (data && data.usageLanguages) {
      rawData = data.usageLanguages;
    } else if (Array.isArray(data)) {
      rawData = data;
    } else {
      rawData = [];
    }

    if (rawData.length > 0) {
      chartData = rawData.map(item => ({
        value: parseInt(item.count, 10),
        name: item.language
      }));
      colors = []; 
    } else {
      chartData = [];
      colors = [];
    }

    return (
      <AnimatedPieChart
        data={chartData}
        chartType={chartType}
        chartName={chartName}
        colors={colors}
        fontSizeMultiplier={fontSizeMultiplier}
      />
    );
  };

  let classname = "";
  let title = "";
  let subtitle = "";
  let chartType = "";

  switch (cellType) {
    case "languageUsage":
      classname = "getStartedDoughutPlot";
      title = "";
      subtitle = "";
      chartType = "";
      break;
    default:
      classname = "";
      title = "";
      subtitle = "";
      chartType = "";
      break;
  }

  return (
    <div className={classname}>
      {renderPlots(data, chartType)}
    </div>
  );
};

export default DoughnutPlot;
