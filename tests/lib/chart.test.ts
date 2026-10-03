import { describe, it, expect } from "vitest";
import {
  CHART_TYPES,
  CHART_SERIES_LIMIT,
  CHART_SERIES_COLORS,
  CHART_ACCENT_COLOR,
  CHART_OVERFLOW_COLOR,
  CHART_TICK_ANGLE_THRESHOLD,
  defaultSeriesColor,
  formatChartValue,
  needsAngledTicks,
  parseChartConfig,
} from "@/lib/chart";

/** A minimal valid line chart, as the prompt teaches it to the model. */
function fenceFactory(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "line",
    title: "Monthly Revenue",
    data: [
      { name: "Jan", value: 100 },
      { name: "Feb", value: 140 },
    ],
    xAxisKey: "name",
    series: [{ dataKey: "value", name: "Revenue" }],
    ...overrides,
  });
}

describe("CHART_TYPES", () => {
  it("lists the types the fence accepts", () => {
    expect(CHART_TYPES).toEqual(["line", "bar", "area", "pie", "composed"]);
  });
});

describe("CHART_SERIES_COLORS", () => {
  it("offers one slot per validated categorical hue", () => {
    expect(CHART_SERIES_COLORS).toHaveLength(CHART_SERIES_LIMIT);
  });

  it("reads every slot from a globals.css custom property", () => {
    for (const color of CHART_SERIES_COLORS) {
      expect(color).toMatch(/^var\(--chart-[a-z0-9-]+\)$/);
    }
  });
});

describe("parseChartConfig", () => {
  it("reports an empty body as empty, not as an error", () => {
    // Mid-stream the body is still arriving; a skeleton is honest, an error is not.
    expect(parseChartConfig("")).toEqual({ status: "empty" });
    expect(parseChartConfig('{"type": "li')).toEqual({ status: "empty" });
  });

  it("reports valid JSON that is not an object as an error", () => {
    for (const body of ["[]", "42", '"line"', "null"]) {
      expect(parseChartConfig(body).status).toBe("error");
    }
  });

  it("reports a missing or unknown type as an error", () => {
    expect(parseChartConfig(fenceFactory({ type: undefined })).status).toBe(
      "error",
    );
    expect(parseChartConfig(fenceFactory({ type: "donut" })).status).toBe(
      "error",
    );
  });

  it("reports data that is missing or not an array as an error", () => {
    expect(parseChartConfig(fenceFactory({ data: undefined })).status).toBe(
      "error",
    );
    expect(parseChartConfig(fenceFactory({ data: {} })).status).toBe("error");
  });

  it("parses a valid chart into a ready view", () => {
    const result = parseChartConfig(fenceFactory());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.view.type).toBe("line");
    expect(result.view.title).toBe("Monthly Revenue");
    expect(result.view.xAxisKey).toBe("name");
    expect(result.view.data).toHaveLength(2);
  });

  it("defaults xAxisKey to name", () => {
    const result = parseChartConfig(fenceFactory({ xAxisKey: undefined }));

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.xAxisKey).toBe("name");
  });

  it("drops the description rather than drawing it beside the title", () => {
    // The title names the chart; a description only restates the message the
    // chart already sits inside.
    const result = parseChartConfig(
      fenceFactory({ description: "Year to date" }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect("description" in result.view).toBe(false);
  });

  it("ignores a second y-axis rather than drawing one", () => {
    // Dual-axis is the single worst chart mistake; the prompt never offers it.
    const result = parseChartConfig(
      fenceFactory({
        series: [
          { dataKey: "value", yAxisId: "right" },
          { dataKey: "other", yAxisId: 1 },
        ],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(JSON.stringify(result.view.series)).not.toContain("yAxisId");
  });
});

describe("parseChartConfig series", () => {
  it("names a series after its dataKey when no name is given", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ dataKey: "value" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series[0].name).toBe("value");
  });

  it("infers one series per numeric key when series is omitted", () => {
    const result = parseChartConfig(
      fenceFactory({
        series: undefined,
        data: [{ name: "Jan", revenue: 10, cost: 4, note: "n/a" }],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series.map((s) => s.dataKey)).toEqual([
      "revenue",
      "cost",
    ]);
  });

  it("assigns the categorical slots in order", () => {
    const result = parseChartConfig(
      fenceFactory({
        series: [{ dataKey: "a" }, { dataKey: "b" }, { dataKey: "c" }],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series.map((s) => s.color)).toEqual([
      CHART_SERIES_COLORS[0],
      CHART_SERIES_COLORS[1],
      CHART_SERIES_COLORS[2],
    ]);
  });

  it("keeps a model-supplied color over the slot", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ dataKey: "value", color: "#ff0000" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series[0].color).toBe("#ff0000");
  });

  it("stops cycling hues past the last slot", () => {
    const result = parseChartConfig(
      fenceFactory({
        series: Array.from({ length: CHART_SERIES_LIMIT + 1 }, (_, i) => ({
          dataKey: `s${i}`,
        })),
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    const colors = result.view.series.map((s) => s.color);
    expect(colors[CHART_SERIES_LIMIT - 1]).toBe(
      CHART_SERIES_COLORS[CHART_SERIES_LIMIT - 1],
    );
    // A generated 9th hue is indistinguishable from an existing one under CVD.
    expect(colors[CHART_SERIES_LIMIT]).toBe(CHART_OVERFLOW_COLOR);
    expect(colors[CHART_SERIES_LIMIT]).not.toBe(CHART_SERIES_COLORS[0]);
  });

  it("defaults each series' mark to the chart's own type", () => {
    const bars = parseChartConfig(
      fenceFactory({ type: "bar", series: [{ dataKey: "value" }] }),
    );
    const areas = parseChartConfig(
      fenceFactory({ type: "area", series: [{ dataKey: "value" }] }),
    );

    if (bars.status !== "ready" || areas.status !== "ready") {
      throw new Error("expected ready");
    }
    expect(bars.view.series[0].type).toBe("bar");
    expect(areas.view.series[0].type).toBe("area");
  });

  it("lets a composed chart mix mark types per series", () => {
    const result = parseChartConfig(
      fenceFactory({
        type: "composed",
        series: [
          { dataKey: "value", chartType: "bar" },
          { dataKey: "trend", chartType: "line" },
        ],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series.map((s) => s.type)).toEqual(["bar", "line"]);
  });

  it("falls back to a line for an unknown series mark", () => {
    const result = parseChartConfig(
      fenceFactory({ type: "composed", series: [{ dataKey: "v", chartType: "radar" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series[0].type).toBe("line");
  });

  it("drops series entries with no dataKey", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ name: "orphan" }, { dataKey: "value" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series.map((s) => s.dataKey)).toEqual(["value"]);
  });

  it("reports a cartesian chart with no drawable series as an error", () => {
    const result = parseChartConfig(
      fenceFactory({ data: [{ name: "Jan", note: "n/a" }], series: undefined }),
    );

    expect(result.status).toBe("error");
  });
});

describe("parseChartConfig single series", () => {
  it("draws a lone series in the accent ink, not a categorical hue", () => {
    // One series has no identity to distinguish, so the chart reads as part of
    // the message rather than as a color-coded legend of one.
    const result = parseChartConfig(fenceFactory());

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series[0].color).toBe(CHART_ACCENT_COLOR);
  });

  it("still prefers a model-supplied color on a lone series", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ dataKey: "value", color: "#123456" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series[0].color).toBe("#123456");
  });

  it("moves to the categorical slots as soon as there are two series", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ dataKey: "a" }, { dataKey: "b" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.series.map((s) => s.color)).toEqual([
      CHART_SERIES_COLORS[0],
      CHART_SERIES_COLORS[1],
    ]);
  });
});

describe("parseChartConfig legend", () => {
  it("shows a legend for two or more series", () => {
    const result = parseChartConfig(
      fenceFactory({ series: [{ dataKey: "a" }, { dataKey: "b" }] }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.showLegend).toBe(true);
  });

  it("omits the legend for a single series", () => {
    // One swatch restates the title and costs space.
    const result = parseChartConfig(fenceFactory());

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.showLegend).toBe(false);
  });
});

describe("parseChartConfig pie", () => {
  it("builds slices from the first series' key", () => {
    const result = parseChartConfig(
      JSON.stringify({
        type: "pie",
        data: [
          { region: "North", revenue: 40 },
          { region: "South", revenue: 60 },
        ],
        xAxisKey: "region",
        series: [{ dataKey: "revenue" }],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.slices).toEqual([
      { name: "North", value: 40, color: CHART_SERIES_COLORS[0] },
      { name: "South", value: 60, color: CHART_SERIES_COLORS[1] },
    ]);
    expect(result.view.series).toEqual([]);
  });

  it("drops slices whose value is not a finite number", () => {
    const result = parseChartConfig(
      JSON.stringify({
        type: "pie",
        data: [
          { region: "North", revenue: 40 },
          { region: "South", revenue: "lots" },
          { region: "East", revenue: null },
        ],
        xAxisKey: "region",
        series: [{ dataKey: "revenue" }],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.slices.map((s) => s.name)).toEqual(["North"]);
  });

  it("names a slice by its category, not its index", () => {
    const result = parseChartConfig(
      JSON.stringify({
        type: "pie",
        data: [{ revenue: 10 }],
        xAxisKey: "region",
        series: [{ dataKey: "revenue" }],
      }),
    );

    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.view.slices[0].name).toBe("");
  });

  it("reports a pie with no usable slices as an error", () => {
    const result = parseChartConfig(
      JSON.stringify({
        type: "pie",
        data: [{ region: "North", revenue: "lots" }],
        series: [{ dataKey: "revenue" }],
      }),
    );

    expect(result.status).toBe("error");
  });
});

describe("needsAngledTicks", () => {
  it("keeps short category labels horizontal", () => {
    const data = [{ name: "Jan" }, { name: "Feb" }];
    expect(needsAngledTicks(data, "name")).toBe(false);
  });

  it("angles ticks once a label passes the threshold", () => {
    const long = "Q".repeat(CHART_TICK_ANGLE_THRESHOLD + 1);
    expect(needsAngledTicks([{ name: long }], "name")).toBe(true);
  });

  it("measures the longest label, not the first", () => {
    const data = [{ name: "Jan" }, { name: "September" }];
    expect(needsAngledTicks(data, "name")).toBe(true);
  });

  it("misses no axis when the key is absent", () => {
    expect(needsAngledTicks([{ name: "September" }], "region")).toBe(false);
  });
});

describe("formatChartValue", () => {
  it("comma-groups ordinary magnitudes", () => {
    expect(formatChartValue(1284)).toBe("1,284");
  });

  it("goes compact once the magnitude gets long", () => {
    // An axis tick has room for "15K", not for "15,000".
    expect(formatChartValue(15000)).toBe("15K");
    expect(formatChartValue(-15000)).toBe("-15K");
  });

  it("keeps small and fractional values readable", () => {
    expect(formatChartValue(0)).toBe("0");
    expect(formatChartValue(0.5)).toBe("0.5");
  });

  it("renders a value it cannot format as an empty string", () => {
    // Better a blank tick than "NaN" printed on the axis.
    expect(formatChartValue(Number.NaN)).toBe("");
    expect(formatChartValue(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatChartValue(null)).toBe("");
    expect(formatChartValue(undefined)).toBe("");
  });

  it("passes a non-numeric value through as text", () => {
    expect(formatChartValue("n/a")).toBe("n/a");
  });
});

describe("defaultSeriesColor", () => {
  it("hands out the slots in order", () => {
    expect(defaultSeriesColor(0)).toBe(CHART_SERIES_COLORS[0]);
    expect(defaultSeriesColor(3)).toBe(CHART_SERIES_COLORS[3]);
  });

  it("falls back to the overflow hue rather than cycling", () => {
    expect(defaultSeriesColor(CHART_SERIES_LIMIT)).toBe(CHART_OVERFLOW_COLOR);
    expect(defaultSeriesColor(CHART_SERIES_LIMIT + 5)).toBe(
      CHART_OVERFLOW_COLOR,
    );
  });
});
