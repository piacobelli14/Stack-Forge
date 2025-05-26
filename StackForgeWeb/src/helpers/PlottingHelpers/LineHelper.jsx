import React, { useEffect, useState, useRef } from "react";
import * as echarts from "echarts";

const LineChart = ({ data, color, yAxisFormatter }) => {
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const getResponsiveOptions = (size) => {
    if (size < 499) {
      return { fontSize: 0, grid: { left: 0, right: 0, bottom: 0, top: 0, containLabel: true }, lineWidth: 0, symbolSize: 0, gridLineWidth: 0, tooltipFontSize: 0 };
    } else if (size >= 500 && size <= 699) {
      return { fontSize: 12, grid: { left: 30, right: 30, bottom: 20, top: 30, containLabel: true }, lineWidth: 2, symbolSize: 6, gridLineWidth: 1, tooltipFontSize: 10 };
    } else if (size >= 700 && size <= 1299) {
      return { fontSize: 12, grid: { left: 40, right: 40, bottom: 15, top: 30, containLabel: true }, lineWidth: 2.5, symbolSize: 8, gridLineWidth: 2, tooltipFontSize: 12 };
    } else if (size >= 1300 && size <= 1699) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 15, top: 30, containLabel: true }, lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 1700 && size <= 2199) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 15, top: 30, containLabel: true }, lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 2200 && size <= 2599) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 15, top: 30, containLabel: true }, lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 2600 && size <= 3899) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 15, top: 30, containLabel: true }, lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 3900 && size <= 5299) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 15, top: 30, containLabel: true }, lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else {
      return { fontSize: 0, grid: { left: 0, right: 0, bottom: 0, top: 0, containLabel: true }, lineWidth: 0, symbolSize: 0, gridLineWidth: 0, tooltipFontSize: 0 };
    }
  };

  useEffect(() => {
    const handleResize = () => setScreenSize(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }

    const dates = data.map(item => {
      if (!item.date || typeof item.date !== "string") {
        return "Invalid Date";
      }
      return item.date; 
    });

    const values = data.map(item => item.value);
    const { fontSize, grid, lineWidth, symbolSize, gridLineWidth, tooltipFontSize } =
      getResponsiveOptions(screenSize);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const interval = range / 2;

    const formatDateLabel = (dateStr) => {
      if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr; 
      }
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day); 
      if (isNaN(date.getTime())) {
        return dateStr;
      }
      return `${date.toLocaleString("default", { month: "short" })} ${date.getDate()}`;
    };

    const formatDateTooltip = (dateStr) => {
      if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr; 
      }
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      if (isNaN(date.getTime())) {
        return dateStr; 
      }
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    };

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params) => {
          const date = params[0].axisValue;
          const formattedDate = formatDateTooltip(date);
          const val = params[0].data;
          const formatted = yAxisFormatter ? yAxisFormatter(val) : val;
          return `
            <div style="color:white;background:rgba(24,24,24,0.95);padding:1vw;border:2px solid #222;border-radius:0.4vw;">
              <div style="font-weight:bold;font-size:${tooltipFontSize}px;color:#fff;">Date: ${formattedDate}</div>
              <hr style="border:0;height:1px;background:rgba(255,255,255,0.6);margin:1vw 0;">
              <div style="color:${params[0].color};">Value: <b style="color:#fff;">${formatted}</b></div>
            </div>`;
        },
        backgroundColor: "transparent",
        borderColor: "transparent",
        padding: 0,
        textStyle: { color: "#fff", fontSize: tooltipFontSize },
      },
      grid: { ...grid },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: "#c1c1c1", width: gridLineWidth } },
        axisTick: { alignWithLabel: false, length: 6, lineStyle: { width: gridLineWidth, color: "#c1c1c1" } },
        axisLabel: {
          color: "#c1c1c1",
          fontSize,
          fontWeight: 700,
          margin: 6,
          formatter: (v) => formatDateLabel(v),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: minValue,
        max: maxValue,
        interval: interval,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false, length: 6, lineStyle: { width: gridLineWidth, color: "#c1c1c1" } },
        axisLabel: {
          color: "#c1c1c1",
          fontSize,
          fontWeight: 700,
          formatter: yAxisFormatter || ((value) => value),
        },
        splitLine: { show: true, lineStyle: { color: "#444", width: gridLineWidth, type: "dashed" } },
      },
      series: [
        {
          type: "line",
          data: values,
          smooth: true,
          lineStyle: { color: color, width: lineWidth },
          itemStyle: { color: color },
          symbol: "circle",
          symbolSize: symbolSize,
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: color },
                { offset: 1, color: "rgba(255, 255, 255, 0)" },
              ],
            },
          },
        },
      ],
    };

    chartInstanceRef.current.setOption(option, true);

    const resizeHandler = () => chartInstanceRef.current.resize();
    window.addEventListener("resize", resizeHandler);

    return () => {
      window.removeEventListener("resize", resizeHandler);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, [data, color, yAxisFormatter, screenSize]);

  return <div ref={chartRef} style={{ width: "100%", height: "150px" }} />;
};

export default LineChart;