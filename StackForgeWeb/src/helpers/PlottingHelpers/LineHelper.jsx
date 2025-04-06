
import React, { useEffect, useState } from "react";
import ReactEcharts from "echarts-for-react";
import useAuth from "../../UseAuth.jsx";

const ManagerLinePlot = ({
  plotType,
  data,
  totalData,
  organizationName,
  style
}) => {
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

  let title, subtitle, classname, seriesName1, seriesData1, seriesColor1;
  let seriesName2, seriesData2, seriesColor2;

  switch (plotType) {
    case "getStartedPageUsagePlot":
      title = "Personal Usage";
      subtitle = "Edits Saved In Last 30 Days";
      classname = "getStartedLinePlot";
      seriesName1 = `Edits Saved`;
      seriesName2 = "";
      seriesData1 = data && data.length ? data.map(item => item.count) : Array(30).fill(0);
      seriesData2 = totalData && totalData.length ? totalData.map(item => item.value) : [];
      seriesColor1 = "#9b59b6";
      seriesColor2 = "#3498db";
      break;
    case "adminAdministratorSigninsPlot":
      title = "Personal Usage";
      subtitle = "Edits Saved In Last 30 Days";
      classname = "personalUsagePlotContainer";
      seriesName1 = `Edits Saved`;
      seriesName2 = "";
      seriesData1 = data && data.length ? data.map(item => item.count) : Array(30).fill(0);
      seriesData2 = totalData && totalData.length ? totalData.map(item => item.value) : [];
      seriesColor1 = "#9b59b6";
      seriesColor2 = "#3498db";
      break;
    default:
      title = "";
      subtitle = "";
      classname = "";
      seriesName1 = "Series 1";
      seriesName2 = "Series 2";
      seriesData1 = data && data.length ? data.map(item => item.value) : [];
      seriesData2 = totalData && totalData.length ? totalData.map(item => item.value) : [];
      seriesColor1 = "#2ecc71";
      seriesColor2 = "#3498db";
      break;
  }

  const { fontSize, grid, lineWidth, symbolSize, gridLineWidth, tooltipFontSize } = getResponsiveOptions(screenSize);

  let dates;
  dates = data && data.length
    ? data.map(item => item.day)
    : (totalData && totalData.length ? totalData.map(item => item.day) : Array(Math.max(data ? data.length : 0, totalData ? totalData.length : 0)).fill(new Date().toISOString().split("T")[0]));


  const formattedLabels = dates.map(date => {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "Invalid Date" : `${d.getMonth() + 1}-${d.getDate()}`;
  });

  const series = [];

  if (seriesData1 && seriesData1.length > 0) {
    const seriesObj = {
      name: seriesName1,
      data: seriesData1,
      type: "line",
      smooth: true,
      itemStyle: {
        color: seriesColor1,
      },
      lineStyle: {
        color: seriesColor1,
        width: lineWidth,
      },
      symbol: "circle",
      symbolSize,
      emphasis: {
        itemStyle: {
          symbolSize: symbolSize * 1.5,
          color: seriesColor1,
        },
      },
      showSymbol: false,
      hoverAnimation: true,
      areaStyle: {
        color: seriesColor1,
        opacity: 0.3,
      }
    };

    series.push(seriesObj);
  }

  if (seriesData2 && seriesData2.length > 0) {
    series.push({
      name: seriesName2,
      data: seriesData2,
      type: "line",
      smooth: true,
      itemStyle: {
        color: seriesColor2,
      },
      lineStyle: {
        color: seriesColor2,
        width: lineWidth,
      },
      symbol: "circle",
      symbolSize,
      emphasis: {
        itemStyle: {
          symbolSize: symbolSize * 1.5,
          color: seriesColor2,
        },
      },
      showSymbol: false,
      hoverAnimation: true,
      areaStyle: {
        color: seriesColor2,
        opacity: 0.3,
      },
    });
  }

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "none",
      },
      formatter: (params) => {
        const date = new Date(params[0].axisValue).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        let tooltipContent = `
          <div class="tooltipWrapper" style="color: white; padding: 0; background-color: rgba(24,24,24,0.95); padding: 1vw; border: 2px solid #222222; border-radius: 0.4vw;">
            <div style="font-weight: bold; font-size: 1.2vw; color: rgba(255,255,255,0.9);">Date: ${date}</div>
            <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.6); width: 100%; margin: 1vw 0;">
        `;

        params.forEach((param) => {
          const num = parseFloat(param.data);
          const formattedValue = !isNaN(num) ? num.toFixed(2) : param.data;
          tooltipContent += `
            <div style="color: ${param.color};">${param.seriesName}: <b style="color: white;">${formattedValue}</b></div>
          `;
        });

        tooltipContent += `</div>`;

        return tooltipContent;
      },
      backgroundColor: "rgba(255,255,255,0.0)",
      borderColor: "rgba(255,255,255,0.0)",
      padding: 0,
      textStyle: {
        color: "#ffffff",
        fontSize: tooltipFontSize,
      },
    },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: {
        formatter: (value, index) => {
          const lastIndex = formattedLabels.length - 1;
          const secondLastIndex = lastIndex - 1;

          if (
            index === 0 ||
            index === lastIndex ||
            (index % 4 === 0 && index !== secondLastIndex)
          ) {
            return formattedLabels[index];
          }
          return "";
        },
        textStyle: { color: "white", fontSize, fontWeight: "bold" },
        showMinLabel: true,
        showMaxLabel: true,
      },
      axisTick: {
        alignWithLabel: true,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(255, 255, 255, 0.2)",
          width: plotType === "getStartedPageUsagePlot" ? 0 : gridLineWidth,
        },
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { show: false },
      splitLine: {
        show: plotType !== "getStartedPageUsagePlot",
        lineStyle: {
          color: "rgba(255, 255, 255, 0.2)",
          width: gridLineWidth,
          type: "dashed",
        },
      },
      axisLine: {
        lineStyle: {
          color: "rgba(255, 255, 255, 0.2)",
          width: plotType === "getStartedPageUsagePlot" ? 0 : gridLineWidth,
        },
      },
    },
    series: series,
    grid: {
      ...grid,
      left: plotType !== "getStartedPageUsagePlot" ? grid.left : 12,
      right: plotType !== "getStartedPageUsagePlot" ? grid.right : 12,
      top: plotType !== "getStartedPageUsagePlot" ? grid.top : 8
    }
  };


  return (
    <div className={classname} style={style}>
      {plotType !== "getStartedPageUsagePlot" ? (
        <>
          <label className="demoPlotTitle">{title}</label>
          <label className="demoPlotSubTitle">{subtitle}</label>
        </>
      ) : (
        <span className="getStartedStack">
          <label className="demoPlotTitleSupplement">{title}</label>
          <label className="demoPlotSubTitleSupplement">{subtitle}</label>
        </span>
      )}
      <ReactEcharts
        option={option}
        style={{
          width: "100%",
          height: "90%",
          maxHeight: "90%",
          maxWidth: "100%",
          overflow: "visible",
        }}
      />
    </div>
  );
};

export default ManagerLinePlot;
