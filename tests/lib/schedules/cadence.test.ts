import { describe, expect, it } from "vitest";
import {
  describeCadence,
  nextOccurrence,
  nextOccurrences,
  validateCadence,
} from "@/lib/schedules/cadence";
import type { ScheduleCadence } from "@/lib/types";

const cron = (expression: string, timezone = "UTC"): ScheduleCadence => ({
  kind: "cron",
  expression,
  timezone,
});

describe("validateCadence", () => {
  it("accepts a well-formed cron cadence", () => {
    expect(validateCadence(cron("0 9 * * 1-5"))).toEqual({ ok: true });
  });

  it("rejects an expression that does not parse", () => {
    const result = validateCadence(cron("every so often"));
    expect(result.ok).toBe(false);
  });

  // Review Focus 1: a parseable expression that can never fire must be reported
  // at save time, not stored and silently skipped forever.
  it("rejects an expression that parses but never fires", () => {
    const result = validateCadence(cron("0 0 30 2 *"));
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("never"),
    });
  });

  it("rejects a timezone that is not a real IANA zone", () => {
    const result = validateCadence(cron("0 9 * * *", "Mars/Olympus"));
    expect(result.ok).toBe(false);
  });

  it("accepts a future once cadence", () => {
    const result = validateCadence({
      kind: "once",
      runAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a once cadence whose runAt is not ISO", () => {
    expect(validateCadence({ kind: "once", runAt: "tomorrow" }).ok).toBe(false);
  });
});

describe("nextOccurrence", () => {
  it("returns the next weekday-9am from a Monday morning", () => {
    // 2026-10-05 is a Monday.
    const from = new Date("2026-10-05T06:00:00.000Z");
    expect(nextOccurrence(cron("0 9 * * 1-5"), from)?.toISOString()).toBe(
      "2026-10-05T09:00:00.000Z",
    );
  });

  it("evaluates the expression in the cadence's zone, not the process zone", () => {
    // 09:00 in Kolkata is 03:30 UTC.
    const from = new Date("2026-10-05T00:00:00.000Z");
    expect(
      nextOccurrence(cron("0 9 * * *", "Asia/Kolkata"), from)?.toISOString(),
    ).toBe("2026-10-05T03:30:00.000Z");
  });

  // Review Focus 3: the 02:00 hour does not exist on this date in New York.
  it("still fires on a DST spring-forward day", () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00.
    const from = new Date("2026-03-08T00:00:00.000Z");
    const next = nextOccurrence(cron("0 2 * * *", "America/New_York"), from);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  // Review Focus 2: next is computed FROM `from`, never by adding a period.
  it("returns one occurrence past a long downtime, not a backlog", () => {
    const from = new Date("2026-10-12T12:00:00.000Z"); // a week after the 5th
    expect(nextOccurrence(cron("0 9 * * 1-5"), from)?.toISOString()).toBe(
      "2026-10-13T09:00:00.000Z", // already past today's 9am -> next weekday
    );
  });

  it("returns null for a once cadence already in the past", () => {
    const from = new Date("2026-10-05T12:00:00.000Z");
    expect(
      nextOccurrence({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }, from),
    ).toBeNull();
  });
});

describe("nextOccurrences", () => {
  it("returns count strictly increasing occurrences", () => {
    const from = new Date("2026-10-05T06:00:00.000Z");
    const list = nextOccurrences(cron("0 9 * * 1-5"), from, 3);
    expect(list).toHaveLength(3);
    expect(list.map((d) => d.toISOString())).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-06T09:00:00.000Z",
      "2026-10-07T09:00:00.000Z",
    ]);
  });

  it("yields only the single remaining occurrence of a once cadence", () => {
    const from = new Date("2026-10-05T06:00:00.000Z");
    expect(
      nextOccurrences({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }, from, 5),
    ).toHaveLength(1);
  });
});

describe("describeCadence", () => {
  it("renders a weekday cron in words with its zone", () => {
    expect(describeCadence(cron("0 9 * * 1-5", "Asia/Kolkata"))).toBe(
      "Weekdays at 09:00, Asia/Kolkata",
    );
  });

  it("falls back to the raw expression for a shape it has no words for", () => {
    expect(describeCadence(cron("*/7 3 * * *"))).toBe("*/7 3 * * * (UTC)");
  });

  it("renders a once cadence as a date", () => {
    expect(
      describeCadence({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }),
    ).toContain("2026");
  });
});
