"use client";

import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type ChartDataPoint = Record<string, unknown>;

interface ChartConfig {
  type: "line" | "bar" | "area" | "pie" | "composed";
  title?: string;
  description?: string;
  data: ChartDataPoint[];
  xAxisKey?: string;
  series: {
    dataKey: string;
    name?: string;
    color?: string;
    stackId?: string;
    type?:
      | "basis"
      | "basisClosed"
      | "basisOpen"
      | "linear"
      | "linearClosed"
      | "natural"
      | "monotoneX"
      | "monotoneY"
      | "monotone"
      | "step"
      | "stepBefore"
      | "stepAfter";
    fill?: string;
    stroke?: string;
    chartType?: "line" | "bar" | "area";
    yAxisId?: string | number;
  }[];
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884d8",
  "#82ca9d",
];

const MAX_LABEL_LENGTH = 18;

function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function hasLongLabels(
  data: ChartDataPoint[],
  key: string,
  threshold = 6,
): boolean {
  return data.some((d) => String(d[key] ?? "").length > threshold);
}

interface CustomTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  angled?: boolean;
}

function CustomXAxisTick({ x = 0, y = 0, payload, angled }: CustomTickProps) {
  const label = ellipsize(String(payload?.value ?? ""), MAX_LABEL_LENGTH);
  if (angled) {
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={12}
          textAnchor="end"
          fill="currentColor"
          fontSize={11}
          transform="rotate(-40)"
        >
          {label}
        </text>
      </g>
    );
  }
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
        fill="currentColor"
        fontSize={11}
      >
        {label}
      </text>
    </g>
  );
}

export function ChartRenderer({ content }: { content: string }) {
  const isHydrated = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const config = useMemo(() => {
    try {
      return JSON.parse(content) as ChartConfig;
    } catch {
      return null;
    }
  }, [content]);

  if (!config || !isHydrated) {
    return (
      <div className="w-full my-6 bg-card-bg border border-card-border rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-card-border bg-secondary/30">
          <div className="h-6 w-1/3 bg-secondary rounded animate-pulse" />
          <div className="h-4 w-1/2 mt-2 bg-secondary/50 rounded animate-pulse" />
        </div>
        <div className="p-4 bg-card-bg">
          <div className="h-[350px] w-full flex items-end justify-between gap-4 p-4">
            <div className="w-12 h-[40%] bg-secondary/50 rounded-t animate-pulse" />
            <div className="w-12 h-[75%] bg-secondary/50 rounded-t animate-pulse" />
            <div className="w-12 h-[55%] bg-secondary/50 rounded-t animate-pulse" />
            <div className="w-12 h-[90%] bg-secondary/50 rounded-t animate-pulse" />
            <div className="w-12 h-[60%] bg-secondary/50 rounded-t animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const {
    type,
    title,
    description,
    data = [],
    xAxisKey = "name",
    series = [],
  } = config;
  const chartData = Array.isArray(data) ? data : [];
  const longLabels = hasLongLabels(chartData, xAxisKey);
  const hasRightAxis = series.some(
    (s) => s.yAxisId === "right" || s.yAxisId === 1,
  );

  return (
    <div className="w-full my-6 bg-card-bg border border-card-border rounded-xl shadow-sm overflow-hidden">
      {(title || description) && (
        <div className="p-4 border-b border-card-border bg-secondary/30">
          {title && <h3 className="font-semibold text-foreground">{title}</h3>}
          {description && (
            <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap wrap-break-words">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="p-4 bg-card-bg">
        <div
          className="w-full text-foreground"
          style={{ height: longLabels ? 440 : 350 }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{
                top: 20,
                right: longLabels ? 60 : 30,
                left: 20,
                bottom: longLabels ? 100 : 20,
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-card-border"
                vertical={false}
              />
              <XAxis
                dataKey={xAxisKey}
                stroke="#888888"
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={<CustomXAxisTick angled={longLabels} />}
                height={longLabels ? 100 : 40}
              />
              <YAxis
                yAxisId="left"
                className="text-xs"
                tick={{ fill: "currentColor" }}
                stroke="#888888"
                tickLine={false}
                axisLine={false}
                dx={-10}
              />
              {hasRightAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  className="text-xs"
                  tick={{ fill: "currentColor" }}
                  stroke="#888888"
                  tickLine={false}
                  axisLine={false}
                  dx={10}
                />
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  color: "#0f172a",
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                }}
                itemStyle={{ fontSize: "12px" }}
                labelStyle={{
                  color: "#64748b",
                  marginBottom: "4px",
                  fontSize: "12px",
                }}
                cursor={{ fill: "rgba(0,0,0,0.05)" }}
              />
              <Legend wrapperStyle={{ paddingTop: "20px" }} />

              {series.map((s, i) => {
                const defaultType =
                  type === "bar" ? "bar" : type === "area" ? "area" : "line";
                const chartType = s.chartType || defaultType;
                const yAxisId = s.yAxisId || "left";
                const color = s.color || COLORS[i % COLORS.length];

                if (chartType === "bar") {
                  return (
                    <Bar
                      key={s.dataKey}
                      dataKey={s.dataKey}
                      name={s.name || s.dataKey}
                      stackId={s.stackId}
                      fill={color}
                      stroke={color}
                      strokeWidth={2}
                      yAxisId={yAxisId}
                      radius={[4, 4, 0, 0]}
                    />
                  );
                }

                if (chartType === "area") {
                  return (
                    <Area
                      key={s.dataKey}
                      type={s.type || "monotone"}
                      dataKey={s.dataKey}
                      name={s.name || s.dataKey}
                      stackId={s.stackId}
                      fill={color}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                      yAxisId={yAxisId}
                      fillOpacity={0.2}
                    />
                  );
                }

                return (
                  <Line
                    key={s.dataKey}
                    type={s.type || "monotone"}
                    dataKey={s.dataKey}
                    name={s.name || s.dataKey}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                    yAxisId={yAxisId}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
