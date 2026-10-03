import { describe, expect, it } from "vitest";
import {
  cadencePreview,
  cadenceTimezone,
  describeCadence,
  formatInstant,
  nextClaim,
  nextOccurrence,
  nextOccurrences,
  nextRunAtISO,
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

  // Review Focus 1, for the other cadence kind: a `once` schedule stored with a
  // past `runAt` gets `nextRunAt: null`, and the due query's `$lte: <iso>` string
  // bound never matches a BSON null -- so it sits enabled and never fires.
  it("rejects a once cadence whose runAt has already passed", () => {
    const result = validateCadence(
      { kind: "once", runAt: "2026-10-02T09:00:00.000Z" },
      new Date("2026-10-03T12:00:00.000Z"),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a once cadence exactly one millisecond ahead of the reference", () => {
    expect(
      validateCadence(
        { kind: "once", runAt: "2026-10-03T12:00:00.001Z" },
        new Date("2026-10-03T12:00:00.000Z"),
      ),
    ).toEqual({ ok: true });
  });
});

describe("nextClaim", () => {
  const now = new Date("2026-10-05T06:00:00.000Z");

  it("advances a cron cadence to its next occurrence and leaves it enabled", () => {
    expect(nextClaim(cron("0 9 * * 1-5"), now)).toEqual({
      ok: true,
      nextRunAt: "2026-10-05T09:00:00.000Z",
      disable: false,
    });
  });

  it("disables a once cadence and leaves no next occurrence", () => {
    expect(
      nextClaim(
        { kind: "once", runAt: "2026-10-05T06:00:00.000Z" },
        now,
      ),
    ).toEqual({ ok: true, nextRunAt: null, disable: true });
  });

  // Review Focus 2's sibling: one stored cadence that no longer computes must not
  // take the whole claim down with it. The store logs and disables on `ok: false`.
  it("reports failure rather than throwing when the cadence does not compute", () => {
    const result = nextClaim(cron("every so often"), now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
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

describe("nextRunAtISO", () => {
  it("returns the next occurrence of a cron cadence as ISO", () => {
    const from = new Date("2026-10-05T06:00:00.000Z");
    expect(nextRunAtISO(cron("0 9 * * 1-5"), from)).toBe(
      "2026-10-05T09:00:00.000Z",
    );
  });

  // Review Focus 1's sibling: a spent `once` has nowhere to go, and fabricating
  // an instant here would store a schedule that fires the moment it is saved.
  it("returns null for a once cadence whose instant has passed", () => {
    const from = new Date("2026-10-05T12:00:00.000Z");
    expect(
      nextRunAtISO({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }, from),
    ).toBeNull();
  });

  it("returns the instant itself for a future once cadence", () => {
    const from = new Date("2026-10-05T06:00:00.000Z");
    expect(
      nextRunAtISO({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }, from),
    ).toBe("2026-10-05T09:00:00.000Z");
  });
});

describe("cadencePreview", () => {
  const from = new Date("2026-10-05T06:00:00.000Z");

  it("returns three strictly increasing occurrences", () => {
    const result = cadencePreview(cron("0 9 * * 1-5"), from);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runs.map((d) => d.toISOString())).toEqual([
      "2026-10-05T09:00:00.000Z",
      "2026-10-06T09:00:00.000Z",
      "2026-10-07T09:00:00.000Z",
    ]);
  });

  // Review Focus 3: the preview runs on every keystroke, so a half-typed
  // expression must be a message, not a throw. `nextOccurrences` throws on an
  // unparseable expression; validating first is what stops that reaching React.
  it("reports a message instead of throwing for an expression that does not parse", () => {
    const result = cadencePreview(cron("every so often"), from);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBeTruthy();
  });

  it("reports a message for an expression that parses but never fires", () => {
    const result = cadencePreview(cron("0 0 30 2 *"), from);
    expect(result.ok).toBe(false);
  });

  // Review Focus 4: the preview must show the instant the schedule will use.
  // `from` is 06:00Z, already past 03:30Z the same day -- Kolkata 09:00 is 03:30
  // UTC, so the next one is the 6th.
  it("previews in the cadence's zone, not the process zone", () => {
    const result = cadencePreview(cron("0 9 * * *", "Asia/Kolkata"), from);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runs[0].toISOString()).toBe("2026-10-06T03:30:00.000Z");
  });

  it("yields the single remaining occurrence of a once cadence", () => {
    const result = cadencePreview(
      { kind: "once", runAt: "2026-10-05T09:00:00.000Z" },
      from,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runs).toHaveLength(1);
  });

  it("returns no runs when asked for none", () => {
    const result = cadencePreview(cron("0 9 * * *"), from, 0);
    expect(result).toEqual({ ok: true, runs: [] });
  });
});

describe("cadenceTimezone", () => {
  it("is the cadence's own zone for a cron cadence", () => {
    expect(cadenceTimezone(cron("0 9 * * *", "Asia/Kolkata"))).toBe(
      "Asia/Kolkata",
    );
  });

  it("falls back to UTC for a once cadence, which has no zone", () => {
    expect(
      cadenceTimezone({ kind: "once", runAt: "2026-10-05T09:00:00.000Z" }),
    ).toBe("UTC");
  });
});

describe("formatInstant", () => {
  // Review Focus 4, user-visible half: a fixed zone makes this deterministic, so
  // it renders identically on the server and on the client -- a locale-default
  // `toLocaleString()` would hydrate against a different zone than it rendered.
  it("renders an instant in the given zone", () => {
    expect(formatInstant("2026-10-05T09:00:00.000Z", "UTC")).toContain("09:00");
  });

  it("renders the same instant differently in a shifted zone", () => {
    expect(formatInstant("2026-10-05T09:00:00.000Z", "Asia/Kolkata")).toContain(
      "14:30",
    );
  });
});
