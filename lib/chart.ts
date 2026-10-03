import type {
  ChartConfig,
  ChartCurve,
  ChartDataPoint,
  ChartParseResult,
  ChartPieSlice,
  ChartSeries,
  ChartSeriesConfig,
  ChartSeriesType,
  ChartType,
} from "@/lib/types";

const TYPES = ["line", "bar", "area", "pie", "composed"] as const;

/**
 * The `type` values a ```` ```chart ```` fence accepts. Named here rather than
 * derived so the fence contract and the prompt copy cannot drift apart; the
 * prompt in `constants/prompt.ts` is taught from this same list.
 */
export const CHART_TYPES: readonly ChartType[] = TYPES;

const TYPE_SET = new Set<string>(TYPES);

const SERIES_TYPES: readonly ChartSeriesType[] = ["line", "bar", "area"];

const SERIES_TYPE_SET = new Set<string>(SERIES_TYPES);

const CURVES: readonly ChartCurve[] = [
  "basis",
  "basisClosed",
  "basisOpen",
  "linear",
  "linearClosed",
  "natural",
  "monotoneX",
  "monotoneY",
  "monotone",
  "step",
  "stepBefore",
  "stepAfter",
];

const CURVE_SET = new Set<string>(CURVES);

const DEFAULT_CURVE: ChartCurve = "monotone";

/**
 * The categorical slots, as `globals.css` custom properties so the light and
 * dark steps swap in one place and match the surface the chart is drawn on.
 *
 * The app's own accent tokens cannot serve here: red next to green is a
 * deuteranope collision (OKLab ΔE 5.0, under the ≥8 gate), and the dark accent
 * steps sit above the dark-surface lightness band entirely. These eight are
 * ordered — the order is the colorblind-safety mechanism, not decoration — and
 * were validated against the app's surfaces (#f9f9f9 light, #111111 dark).
 */
export const CHART_SERIES_COLORS: readonly string[] = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

/** How many categorical slots exist. Past this a series folds, never cycles. */
export const CHART_SERIES_LIMIT = CHART_SERIES_COLORS.length;

/**
 * What a lone series is drawn in. A single series has no identity to
 * distinguish, so a categorical hue would announce a legend of one; the accent
 * ink instead lets the chart read as part of the message it sits in.
 */
export const CHART_ACCENT_COLOR = "var(--accent)";

/**
 * What a series past the last slot is drawn in. Reusing a slot would make two
 * series indistinguishable and a generated hue is indistinguishable too, so the
 * tail is de-emphasized instead.
 */
export const CHART_OVERFLOW_COLOR = "var(--chart-overflow)";

/** Labels longer than this many characters push the x ticks onto an angle. */
export const CHART_TICK_ANGLE_THRESHOLD = 6;

/** The category key the prompt's example uses, and the fence's default. */
export const DEFAULT_CHART_X_AXIS_KEY = "name";

/**
 * The color for the series (or slice) at `index`. Slots are handed out in fixed
 * order — never cycled — because a reader who learned "this is the third
 * series" must not have it repainted when a series is added.
 */
export function defaultSeriesColor(index: number): string {
  if (index < 0 || index >= CHART_SERIES_LIMIT) {
    return CHART_OVERFLOW_COLOR;
  }
  return CHART_SERIES_COLORS[index];
}

/** Whether any category label is long enough to need an angled x tick. */
export function needsAngledTicks(
  data: readonly ChartDataPoint[],
  xAxisKey: string,
): boolean {
  return data.some(
    (row) => String(row[xAxisKey] ?? "").length > CHART_TICK_ANGLE_THRESHOLD,
  );
}

const PLAIN_NUMBER = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const COMPACT_NUMBER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Past this magnitude a tick is abbreviated, because the tick band is narrow. */
const COMPACT_FROM = 10_000;

/**
 * How a value is written on an axis tick or in a tooltip: comma-grouped, and
 * compact once it gets long. A non-finite number renders as nothing rather than
 * as `NaN`, which is what a tick would otherwise read.
 */
export function formatChartValue(value: unknown): string {
  if (typeof value !== "number") {
    return value === null || value === undefined ? "" : String(value);
  }
  if (!Number.isFinite(value)) {
    return "";
  }
  return Math.abs(value) >= COMPACT_FROM
    ? COMPACT_NUMBER.format(value)
    : PLAIN_NUMBER.format(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The row's keys whose first value is a real number, in insertion order. */
function numericKeys(row: ChartDataPoint, exclude: string): string[] {
  return Object.entries(row)
    .filter(
      ([key, value]) =>
        key !== exclude && typeof value === "number" && Number.isFinite(value),
    )
    .map(([key]) => key);
}

function seriesMark(
  config: ChartSeriesConfig | undefined,
  chartType: ChartType,
): ChartSeriesType {
  const declared = asNonEmptyString(config?.chartType);
  if (declared && SERIES_TYPE_SET.has(declared)) {
    return declared as ChartSeriesType;
  }
  if (chartType === "bar" || chartType === "area") {
    return chartType;
  }
  return "line";
}

function seriesCurve(config: ChartSeriesConfig | undefined): ChartCurve {
  const declared = asNonEmptyString(config?.type);
  return declared && CURVE_SET.has(declared)
    ? (declared as ChartCurve)
    : DEFAULT_CURVE;
}

/**
 * Turns the declared series into drawable ones. When the fence omits `series`
 * entirely — a model that wrote data but no series is common enough — one series
 * is inferred per numeric key in the first row, which draws the chart the
 * author plainly meant instead of an error.
 */
function buildSeries(
  config: ChartConfig,
  data: readonly ChartDataPoint[],
  xAxisKey: string,
  chartType: ChartType,
): ChartSeries[] {
  const declared = Array.isArray(config.series) ? config.series : [];

  const keyed = declared.filter((entry) => isPlainObject(entry)) as
    ChartSeriesConfig[];

  const keys: { key: string; config: ChartSeriesConfig }[] = keyed
    .map((entry) => ({
      key: asNonEmptyString(entry.dataKey) ?? "",
      config: entry,
    }))
    .filter((entry) => entry.key !== "");

  const withKeys =
    keys.length > 0
      ? keys
      : numericKeys(data[0] ?? {}, xAxisKey).map((key) => ({
          key,
          config: {} as ChartSeriesConfig,
        }));

  return withKeys.map((entry, index) => ({
    dataKey: entry.key,
    name: asNonEmptyString(entry.config.name) ?? entry.key,
    color:
      asNonEmptyString(entry.config.color) ??
      (withKeys.length === 1
        ? CHART_ACCENT_COLOR
        : defaultSeriesColor(index)),
    type: seriesMark(entry.config, chartType),
    stackId: asNonEmptyString(entry.config.stackId),
    curve: seriesCurve(entry.config),
  }));
}

/**
 * Turns the rows into pie slices. Values that are not real numbers are dropped
 * rather than coerced: a slice drawn from `"lots"` would be a lie, and a row
 * with no category still carries a value worth showing.
 */
function buildSlices(
  config: ChartConfig,
  data: readonly ChartDataPoint[],
  xAxisKey: string,
): ChartPieSlice[] {
  const declared = Array.isArray(config.series) ? config.series : [];
  const first = declared.find((entry) => isPlainObject(entry)) as
    | ChartSeriesConfig
    | undefined;

  const valueKey =
    asNonEmptyString(first?.dataKey) ??
    numericKeys(data[0] ?? {}, xAxisKey)[0];

  if (!valueKey) {
    return [];
  }

  return data
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => {
      const value = row[valueKey];
      return typeof value === "number" && Number.isFinite(value);
    })
    .map(({ row, index }) => ({
      name: String(row[xAxisKey] ?? ""),
      value: row[valueKey] as number,
      color: defaultSeriesColor(index),
    }));
}

/**
 * Reads a ```` ```chart ```` fence body into a drawable view.
 *
 * Nothing here throws and nothing touches the DOM: the fence arrives while the
 * model is still writing it, so "not JSON yet" is an ordinary state (`empty`),
 * and a body that parsed but cannot be drawn is the other one (`error`). The
 * caller decides which of those to show while streaming.
 */
export function parseChartConfig(content: string): ChartParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { status: "empty" };
  }

  if (!isPlainObject(raw)) {
    return { status: "error", message: "A chart must be a JSON object." };
  }

  const config = raw as ChartConfig;

  const declaredType = asNonEmptyString(config.type);
  if (!declaredType || !TYPE_SET.has(declaredType)) {
    return {
      status: "error",
      message: `A chart needs a type of ${TYPES.join(", ")}.`,
    };
  }
  const type = declaredType as ChartType;

  const rows = Array.isArray(config.data)
    ? config.data.filter(isPlainObject)
    : [];

  if (rows.length === 0) {
    return { status: "error", message: "A chart needs a non-empty data array." };
  }

  const xAxisKey =
    asNonEmptyString(config.xAxisKey) ?? DEFAULT_CHART_X_AXIS_KEY;

  const base = {
    type,
    title: asNonEmptyString(config.title),
    data: rows,
    xAxisKey,
  };

  if (type === "pie") {
    const slices = buildSlices(config, rows, xAxisKey);
    if (slices.length === 0) {
      return {
        status: "error",
        message: "A pie needs a numeric value for each slice.",
      };
    }
    return {
      status: "ready",
      view: {
        ...base,
        series: [],
        slices,
        angledTicks: false,
        showLegend: slices.length >= 2,
      },
    };
  }

  const series = buildSeries(config, rows, xAxisKey, type);
  if (series.length === 0) {
    return {
      status: "error",
      message: "A chart needs at least one numeric series.",
    };
  }

  return {
    status: "ready",
    view: {
      ...base,
      series,
      slices: [],
      angledTicks: needsAngledTicks(rows, xAxisKey),
      showLegend: series.length >= 2,
    },
  };
}
