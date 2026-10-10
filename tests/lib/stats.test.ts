import { describe, it, expect } from "vitest";
import {
  HOME_STATS_WINDOW_DAYS,
  windowStartIso,
  summarizeThreadUsage,
  summarizeTokenUsage,
} from "@/lib/stats";

const NOW = new Date("2026-10-10T12:00:00.000Z");

describe("windowStartIso", () => {
  it("returns the instant one window before now", () => {
    expect(windowStartIso(NOW)).toBe("2026-10-03T12:00:00.000Z");
  });

  it("crosses a month boundary without arithmetic on calendar fields", () => {
    expect(windowStartIso(new Date("2026-03-03T00:00:00.000Z"))).toBe(
      "2026-02-24T00:00:00.000Z",
    );
  });

  it("defaults to the home window length", () => {
    expect(windowStartIso(NOW)).toBe(windowStartIso(NOW, HOME_STATS_WINDOW_DAYS));
  });

  it("honours an explicit window", () => {
    expect(windowStartIso(NOW, 1)).toBe("2026-10-09T12:00:00.000Z");
  });

  it("emits an ISO string, which is what makes it a valid stored-date bound", () => {
    // Stored dates are ISO 8601 strings, and those sort chronologically, so the
    // bound is compared as a string. A Date object here would match nothing.
    expect(typeof windowStartIso(NOW)).toBe("string");
    expect(new Date(windowStartIso(NOW)).toISOString()).toBe(windowStartIso(NOW));
  });
});

describe("summarizeThreadUsage", () => {
  it("reads the single grouped row", () => {
    expect(summarizeThreadUsage([{ threads: 98, messages: 2412 }])).toEqual({
      total: 98,
      messages: 2412,
    });
  });

  it("reports zeroes when the aggregation matched nothing", () => {
    // A `$group` with `_id: null` over an empty match returns no rows at all.
    expect(summarizeThreadUsage([])).toEqual({ total: 0, messages: 0 });
  });

  it("treats a sum no document contributed to as zero", () => {
    // `$sum` omits a field when no document carries it; a thread created before
    // `messageCount` existed is the real case.
    expect(summarizeThreadUsage([{ threads: 3 }])).toEqual({
      total: 3,
      messages: 0,
    });
  });
});

describe("summarizeTokenUsage", () => {
  it("reads prompt and completion off the grouped row", () => {
    expect(summarizeTokenUsage([{ prompt: 1000, completion: 250 }])).toEqual({
      prompt: 1000,
      completion: 250,
    });
  });

  it("reports zeroes when nothing matched", () => {
    expect(summarizeTokenUsage([])).toEqual({ prompt: 0, completion: 0 });
  });

  it("defaults each half independently", () => {
    expect(summarizeTokenUsage([{ prompt: 42 }])).toEqual({
      prompt: 42,
      completion: 0,
    });
  });
});
