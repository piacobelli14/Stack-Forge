import React, { useEffect, useState, useRef } from "react";
import * as echarts from "echarts";

const BarChart = ({ data, startDate, endDate, visibleSeries }) => {
  const [screenSize, setScreenSize] = useState(window.innerWidth);
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const getResponsiveOptions = (size) => {
    if (size < 499) {
      return { fontSize: 0, grid: { left: 0, right: 0, bottom: 0, top: 0, containLabel: true }, barWidth: "15%", lineWidth: 0, symbolSize: 0, gridLineWidth: 0, tooltipFontSize: 0 };
    } else if (size >= 500 && size <= 699) {
      return { fontSize: 12, grid: { left: 50, right: 50, bottom: 20, top: 50, containLabel: true }, barWidth: "20%", lineWidth: 2, symbolSize: 6, gridLineWidth: 1, tooltipFontSize: 10 };
    } else if (size >= 700 && size <= 1299) {
      return { fontSize: 12, grid: { left: 40, right: 40, bottom: 15, top: 45, containLabel: true }, barWidth: "20%", lineWidth: 3, symbolSize: 8, gridLineWidth: 2, tooltipFontSize: 12 };
    } else if (size >= 1300 && size <= 1699) {
      return { fontSize: 12, grid: { left: 100, right: 100, bottom: 15, top: 45, containLabel: true }, barWidth: "20%", lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 1700 && size <= 2199) {
        return { fontSize: 12, grid: { left: 100, right: 100, bottom: 15, top: 45, containLabel: true }, barWidth: "20%", lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 2200 && size <= 2599) {
        return { fontSize: 12, grid: { left: 100, right: 100, bottom: 15, top: 45, containLabel: true }, barWidth: "20%", lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 2600 && size <= 3899) {
        return { fontSize: 12, grid: { left: 100, right: 100, bottom: 15, top: 45, containLabel: true }, barWidth: "10%", lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else if (size >= 3900 && size <= 5299) {
        return { fontSize: 12, grid: { left: 100, right: 100, bottom: 15, top: 45, containLabel: true }, barWidth: "10%", lineWidth: 4, symbolSize: 10, gridLineWidth: 2.5, tooltipFontSize: 12 };
    } else {
      return { fontSize: 0, grid: { left: 0, right: 0, bottom: 0, top: 0, containLabel: true }, barWidth: "10%", lineWidth: 0, symbolSize: 0, gridLineWidth: 0, tooltipFontSize: 0 };
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

    const dateRange = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      dateRange.push(new Date(currentDate).toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const mergedData = dateRange.map((date) => {
      const existing = data.find((item) => item.period === date) || {};
      return {
        period: date,
        pageviews: existing.pageviews || 0,
        uniqueVisitors: existing.uniqueVisitors || 0,
        bounceRate: existing.bounceRate || 0,
      };
    });

    const dates = mergedData.map((item) => item.period);
    const pageViews = mergedData.map((item) => item.pageviews);
    const uniqueVisitors = mergedData.map((item) => item.uniqueVisitors);
    const bounceRates = mergedData.map((item) => item.bounceRate * 100);
    const { fontSize, grid, barWidth, lineWidth, symbolSize, gridLineWidth, tooltipFontSize } =
      getResponsiveOptions(screenSize);

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const date = new Date(params[0].axisValue).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          let tooltipContent = `<div style="color:white;background:rgba(24,24,24,0.95);padding:1vw;border:2px solid #222;border-radius:0.4vw;"><div style="font-weight:bold;font-size:${tooltipFontSize}px;color:#fff;">Date: ${date}</div><hr style="border:0;height:1px;background:rgba(255,255,255,0.6);margin:1vw 0;">`;
          params.forEach((p) => {
            const val = parseFloat(p.data);
            const formatted = !isNaN(val)
              ? p.seriesName === "Bounce Rate"
                ? val.toFixed(1) + "%"
                : val.toFixed(0)
              : p.data;
            tooltipContent += `<div style="color:${p.color};">${p.seriesName}: <b style="color:#fff;">${formatted}</b></div>`;
          });
          return tooltipContent + `</div>`;
        },
        backgroundColor: "transparent",
        borderColor: "transparent",
        padding: 0,
        textStyle: { color: "#fff", fontSize: tooltipFontSize },
      },
      legend: { show: false },
      grid: { ...grid, backgroundColor: "transparent", top: grid.top + 20 },
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
          formatter: (v) => {
            const d = new Date(v);
            return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
          },
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "Page Views",
          nameTextStyle: { color: "#c1c1c1", fontSize, fontWeight: "700" },
          nameGap: 30,
          axisLine: { show: false },
          axisTick: { show: false, length: 6, lineStyle: { width: gridLineWidth, color: "#f5f5f5" } },
          axisLabel: { color: "#c1c1c1", fontSize, fontWeight: "700" },
          splitLine: { show: true, lineStyle: { color: "#444", width: gridLineWidth, type: "dashed" } },
        },
        {
          type: "value",
          name: "Bounce Rate (%)",
          nameTextStyle: { color: "#c1c1c1", fontSize, fontWeight: "700" },
          nameGap: 30,
          axisLine: { show: false },
          axisTick: { show: false, length: 6, lineStyle: { width: gridLineWidth, color: "#f5f5f5" } },
          axisLabel: { color: "#c1c1c1", fontSize, fontWeight: "700", formatter: "{value}%" },
          splitLine: { show: false },
        },
      ],
      series: [
        visibleSeries.pageViews
          ? { name: "Page Views", type: "bar", data: pageViews, barWidth, itemStyle: { color: "rgba(84, 112, 198, 0.6)", borderRadius: [4, 4, 0, 0] } }
          : { name: "Page Views", type: "bar", data: [], barWidth, itemStyle: { color: "rgba(84, 112, 198, 0.6)", borderRadius: [4, 4, 0, 0] } },
        visibleSeries.visitors
          ? { name: "Visitors", type: "bar", data: uniqueVisitors, barWidth, itemStyle: { color: "rgba(86, 222, 163, 0.6)", borderRadius: [4, 4, 0, 0] } }
          : { name: "Visitors", type: "bar", data: [], barWidth, itemStyle: { color: "rgba(86, 222, 163, 0.6)", borderRadius: [4, 4, 0, 0] } },
        visibleSeries.bounceRate
          ? { name: "Bounce Rate", type: "bar", yAxisIndex: 1, data: bounceRates, barWidth, itemStyle: { color: "rgba(155, 89, 182, 0.6)", borderRadius: [4, 4, 0, 0] } }
          : { name: "Bounce Rate", type: "bar", yAxisIndex: 1, data: [], barWidth, itemStyle: { color: "rgba(155, 89, 182, 0.6)", borderRadius: [4, 4, 0, 0] } },
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
  }, [data, screenSize, startDate, endDate, visibleSeries]);

  return <div ref={chartRef} style={{ width: "100%", height: "100%" }} />;
};

export default BarChart;