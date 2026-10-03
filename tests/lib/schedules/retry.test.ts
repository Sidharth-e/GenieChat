import { describe, expect, it } from "vitest";
import {
  backoffMs,
  isTerminalErrorCode,
  nextAttemptDelayMs,
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
