"use client";

import * as React from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatChartValue, parseChartConfig } from "@/lib/chart";
import type { ChartSeries, ChartView } from "@/lib/types";

/**
 * The plot's height, in pixels, including the x-axis band. Recharts allocates
 * the axis inside this box, so the number has to be the plot *plus* its labels
 * — a height that only fits the plot is what gives a chart a cramped axis.
 */
const PLOT_HEIGHT = 240;
const PLOT_HEIGHT_ANGLED = 300;

/** Marks are capped rather than filling the slot, so a band keeps its air. */
const MAX_BAR_WIDTH = 24;

/** Markers stop earning their ink once the points crowd together. */
const MAX_DOTTED_POINTS = 24;

/** Recessive ink for ticks and axis text — never the series color. */
const AXIS_INK = "var(--text-soft)";

/** The surfaces a marker's ring is punched out of, so it stays legible. */
const SURFACE = "var(--bg)";

export function ChartRenderer({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const result = React.useMemo(() => parseChartConfig(content), [content]);

  if (result.status === "empty") {
    // Mid-stream the body is still arriving, so a skeleton is honest; once the
    // stream ends the same body is simply malformed, and saying so is better
    // than a placeholder that pulses forever.
    return isStreaming ? <ChartSkeleton /> : <ChartError />;
  }

  if (result.status === "error") {
    return <ChartError message={result.message} />;
  }

  return <ChartViewFigure view={result.view} />;
}

/**
 * Renders a ```` ```chart ```` fence as part of the message rather than as a
 * card inside it: the title is set as flow content at message scale and the
 * plot follows directly. There is no tinted header bar, no border and no nested
 * padding — the chrome that made the chart read as a widget dropped into the
 * conversation. Nor a description line: the title names the chart, and anything
 * more belongs to the message the chart sits in.
 */
function ChartViewFigure({ view }: { view: ChartView }) {
  const isPie = view.type === "pie";

  return (
    <figure className="my-5">
      {view.title && (
        <figcaption className="mb-3">
          <h4 className="text-[0.9375rem] font-medium text-foreground">
            {view.title}
          </h4>
        </figcaption>
      )}

      {isPie ? <PiePlot view={view} /> : <CartesianPlot view={view} />}

      {view.showLegend && (
        <ChartLegend
          entries={
            isPie
              ? view.slices.map((slice) => ({
                  name: slice.name,
                  color: slice.color,
                }))
              : view.series.map((series) => ({
                  name: series.name,
                  color: series.color,
                }))
          }
        />
      )}
    </figure>
  );
}

function CartesianPlot({ view }: { view: ChartView }) {
  const showDots = view.data.length <= MAX_DOTTED_POINTS;
  const height = view.angledTicks ? PLOT_HEIGHT_ANGLED : PLOT_HEIGHT;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={view.data}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        barGap={2}
      >
        {/* Hairline and solid: dashing reads as a threshold, which it is not. */}
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey={view.xAxisKey}
          tickLine={false}
          axisLine={false}
          interval={view.angledTicks ? 0 : "preserveStartEnd"}
          height={view.angledTicks ? 72 : 28}
          tick={<AxisTick angled={view.angledTicks} />}
        />
        {/* One scale, always. Two y-axes invent a correlation the data lacks. */}
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatChartValue}
          tick={{ fill: AXIS_INK, fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          content={(props) => <ChartTooltip {...props} />}
        />

        {view.series.map((series) => (
          <Series key={series.dataKey} series={series} showDots={showDots} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Series({
  series,
  showDots,
}: {
  series: ChartSeries;
  showDots: boolean;
}) {
  if (series.type === "bar") {
    return (
      <Bar
        dataKey={series.dataKey}
        name={series.name}
        stackId={series.stackId}
        fill={series.color}
        maxBarSize={MAX_BAR_WIDTH}
        radius={[4, 4, 0, 0]}
      />
    );
  }

  if (series.type === "area") {
    return (
      <Area
        dataKey={series.dataKey}
        name={series.name}
        stackId={series.stackId}
        type={series.curve}
        stroke={series.color}
        strokeWidth={2}
        // A wash, never a saturated block: the fill must not outweigh the line.
        fill={series.color}
        fillOpacity={0.1}
        dot={false}
        activeDot={markerProps(series.color, 5)}
      />
    );
  }

  return (
    <Line
      dataKey={series.dataKey}
      name={series.name}
      type={series.curve}
      stroke={series.color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      dot={showDots ? markerProps(series.color, 4) : false}
      activeDot={markerProps(series.color, 5)}
    />
  );
}

/**
 * A marker, ringed in the surface color. The ring is what keeps a dot legible
 * where it crosses a line or another dot — a border in the series color would
 * just add ink that is not data.
 */
function markerProps(color: string, radius: number) {
  return { r: radius, fill: color, stroke: SURFACE, strokeWidth: 2 };
}

function PiePlot({ view }: { view: ChartView }) {
  return (
    <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
      <PieChart margin={{ top: 8, right: 72, bottom: 8, left: 72 }}>
        <Pie
          data={view.slices}
          dataKey="value"
          nameKey="name"
          outerRadius={84}
          // The 2px surface gap between slices, in the surface color.
          stroke={SURFACE}
          strokeWidth={2}
          label={renderPieLabel}
          labelLine={{ stroke: "var(--border-strong)" }}
        >
          {view.slices.map((slice, index) => (
            <Cell key={`${slice.name || "slice"}-${index}`} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          cursor={false}
          content={(props) => <ChartTooltip {...props} />}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

interface PieLabelProps {
  x?: number;
  y?: number;
  textAnchor?: "start" | "middle" | "end";
  name?: string;
}

/**
 * Slice labels ride outside the arc. They wear the secondary ink, never the
 * slice color — a pale categorical hue is illegible as text, and identity
 * already comes from the colored slice beside it.
 */
function renderPieLabel(props: unknown) {
  const { x = 0, y = 0, textAnchor, name } = props as PieLabelProps;
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      dominantBaseline="central"
      fontSize={11}
      fill="var(--text-secondary)"
    >
      {name}
    </text>
  );
}

interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  angled?: boolean;
}

/** Long category labels are angled rather than truncated or overlapped. */
function AxisTick({ x = 0, y = 0, payload, angled }: AxisTickProps) {
  const label = String(payload?.value ?? "");

  if (!angled) {
    return (
      <text
        x={x}
        y={y}
        dy={12}
        textAnchor="middle"
        fontSize={11}
        fill={AXIS_INK}
      >
        {label}
      </text>
    );
  }

  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor="end"
      fontSize={11}
      fill={AXIS_INK}
      transform={`rotate(-40, ${x}, ${y})`}
    >
      {label}
    </text>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  label?: unknown;
  /**
   * Recharts' own payload shape, widened: `name` and `value` come back as its
   * internal `NameType`/`ValueType` unions, and we only ever stringify them.
   */
  payload?: readonly {
    name?: unknown;
    value?: unknown;
    color?: string;
  }[];
}

/**
 * The hover layer, drawn from the same tokens as everything else — the old
 * hardcoded white card was white-on-white in dark mode.
 */
function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const heading = label === undefined ? null : String(label);

  return (
    <div className="rounded-lg border border-card-border bg-card-bg px-3 py-2 shadow-md">
      {heading && (
        <p className="mb-1.5 text-xs text-text-secondary">{heading}</p>
      )}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li
            key={`${String(entry.name ?? "value")}-${index}`}
            className="flex items-center gap-2 text-xs text-foreground"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-text-secondary">{String(entry.name ?? "")}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatChartValue(entry.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Identity is never color alone: every entry is named beside its key. */
function ChartLegend({
  entries,
}: {
  entries: { name: string; color: string }[];
}) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {entries.map((entry, index) => (
        <li
          key={`${entry.name || "series"}-${index}`}
          className="flex items-center gap-1.5 text-xs text-text-secondary"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.name}
        </li>
      ))}
    </ul>
  );
}

function ChartSkeleton() {
  return (
    <div className="my-5 flex h-[240px] items-end gap-3" aria-hidden>
      {[40, 72, 55, 88, 62].map((height, index) => (
        <div
          key={index}
          className="flex-1 animate-pulse rounded-t bg-muted"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function ChartError({ message }: { message?: string }) {
  return (
    <div className="my-5 border-l-2 border-[var(--red)] pl-3">
      <p className="text-xs font-medium tracking-wide text-text-secondary uppercase">
        Chart
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {message ?? "This fence is not valid JSON."}
      </p>
    </div>
  );
}
