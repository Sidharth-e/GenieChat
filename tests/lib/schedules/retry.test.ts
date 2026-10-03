import { describe, expect, it } from "vitest";
import {
  backoffMs,
  isRunOpen,
  isTerminalErrorCode,
  nextAttemptDelayMs,
  reaperOutcome,
} from "@/lib/schedules/retry";
import {
  SCHEDULE_BACKOFF_BASE_MS,
  SCHEDULE_BACKOFF_CAP_MS,
} from "@/constants/schedules";

/** A fixed random makes the jitter reproducible, so the test pins the curve. */
const mid = () => 0.5;

describe("backoffMs", () => {
  it("doubles with each attempt", () => {
    expect(backoffMs(1, mid)).toBe(SCHEDULE_BACKOFF_BASE_MS);
    expect(backoffMs(2, mid)).toBe(SCHEDULE_BACKOFF_BASE_MS * 2);
    expect(backoffMs(3, mid)).toBe(SCHEDULE_BACKOFF_BASE_MS * 4);
  });

  it("never exceeds the cap, however many attempts", () => {
    expect(backoffMs(50, mid)).toBe(SCHEDULE_BACKOFF_CAP_MS);
  });

  it("stays within +/-20% of the nominal delay", () => {
    const nominal = SCHEDULE_BACKOFF_BASE_MS;
    expect(backoffMs(1, () => 0)).toBeGreaterThanOrEqual(nominal * 0.8);
    expect(backoffMs(1, () => 1)).toBeLessThanOrEqual(nominal * 1.2);
  });
});

describe("isTerminalErrorCode", () => {
  it("classifies the four outcomes a retry cannot change", () => {
    for (const code of [
      "target_not_found",
      "unauthorized",
      "invalid_input",
      "invalid_target",
    ]) {
      expect(isTerminalErrorCode(code)).toBe(true);
    }
  });

  it("treats a provider failure as retryable", () => {
    expect(isTerminalErrorCode("provider_error")).toBe(false);
    expect(isTerminalErrorCode("lease_expired")).toBe(false);
  });
});

describe("nextAttemptDelayMs", () => {
  it("returns a delay while attempts remain", () => {
    expect(nextAttemptDelayMs(1, "provider_error", mid)).toBe(
      SCHEDULE_BACKOFF_BASE_MS,
    );
  });

  // A retry cannot turn "the target is gone" into a success, so it must not
  // consume the remaining attempts.
  it("returns null for a terminal code even with attempts left", () => {
    expect(nextAttemptDelayMs(1, "target_not_found", mid)).toBeNull();
  });
});

/**
 * Lives here rather than in a store test because the decision is retry policy,
 * not storage: the store's module graph reaches `lib/env`, so testing it there
 * would mean stubbing a database URI to exercise a pure branch.
 */
describe("reaperOutcome", () => {
  const NOW = new Date("2026-10-05T12:00:00.000Z");

  it("hands a lapsed run back for retry while attempts remain", () => {
    const outcome = reaperOutcome({ attempt: 1, maxAttempts: 3 }, NOW, mid);
    expect(outcome.status).toBe("pending");
    expect(outcome).toMatchObject({
      nextAttemptAt: new Date(
        NOW.getTime() + SCHEDULE_BACKOFF_BASE_MS,
      ).toISOString(),
      error: { code: "lease_expired", retryable: true },
    });
  });

  it("fails a lapsed run once its attempts are exhausted", () => {
    const outcome = reaperOutcome({ attempt: 3, maxAttempts: 3 }, NOW, mid);
    expect(outcome.status).toBe("failed");
    expect(outcome).toMatchObject({ error: { code: "lease_expired" } });
  });

  // The boundary: the `maxAttempts`-th attempt is the last one, not one more.
  // `attempt` is incremented by the claim, so a run at the ceiling has already
  // spent every permitted attempt; handing it back would retry forever.
  it("does not retry on the final permitted attempt", () => {
    expect(reaperOutcome({ attempt: 2, maxAttempts: 3 }, NOW, mid).status).toBe(
      "pending",
    );
    expect(reaperOutcome({ attempt: 3, maxAttempts: 3 }, NOW, mid).status).toBe(
      "failed",
    );
  });
});

describe("isRunOpen", () => {
  // Review: the UI polls while a run is open, and stops on a terminal status.
  // `skipped` and `cancelled` are terminal too -- a run that will never execute
  // must not keep a polling loop alive.
  it("treats pending and running as open", () => {
    expect(isRunOpen("pending")).toBe(true);
    expect(isRunOpen("running")).toBe(true);
  });

  it("treats every settled status as closed", () => {
    for (const status of ["succeeded", "failed", "skipped", "cancelled"] as const) {
      expect(isRunOpen(status), status).toBe(false);
    }
  });
});
