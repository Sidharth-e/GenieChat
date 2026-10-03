import { describe, expect, it } from "vitest";
import { nextRunAtFor } from "@/lib/workflow/schedule";

const from = new Date("2026-10-03T10:00:00.000Z");

describe("nextRunAtFor", () => {
  it("has no next run for a manual trigger", () => {
    expect(nextRunAtFor({ type: "manual" }, from)).toBeNull();
  });

  it("has no next run for a webhook trigger", () => {
    expect(nextRunAtFor({ type: "webhook" }, from)).toBeNull();
  });

  it("has no next run for a schedule with no expression", () => {
    expect(nextRunAtFor({ type: "schedule", config: {} }, from)).toBeNull();
  });

  it("returns the next fire time after the given instant", () => {
    const next = nextRunAtFor(
      { type: "schedule", config: { cronExpression: "*/5 * * * *" } },
      from,
    );
    expect(next).not.toBeNull();
    const delta = new Date(next!).getTime() - from.getTime();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("is strictly after the given instant, not at it", () => {
    // 2026-10-03 10:00 in whatever timezone the parse resolves in: the cron
    // fires at 10:00, so the next occurrence must be tomorrow at 10:00 — never
    // this instant, or a claim would be immediately due again.
    //
    // The instant is built from local date parts, not a UTC string, because
    // the parse is deliberately local (see Step 3). A fixed `...Z` instant
    // would make this test pass on a UTC host and fail everywhere else.
    const at10 = new Date(2026, 9, 3, 10, 0, 0, 0);
    const next = nextRunAtFor(
      { type: "schedule", config: { cronExpression: "0 10 * * *" } },
      at10,
    );
    expect(next).not.toBeNull();
    const nextDate = new Date(next!);
    expect(nextDate.getTime()).toBeGreaterThan(at10.getTime());
    expect(nextDate.getHours()).toBe(10);
    expect(nextDate.getMinutes()).toBe(0);
    expect(nextDate.getDate()).toBe(4);
  });

  it("throws on an expression it cannot parse", () => {
    expect(() =>
      nextRunAtFor(
        { type: "schedule", config: { cronExpression: "every so often" } },
        from,
      ),
    ).toThrow();
  });
});
