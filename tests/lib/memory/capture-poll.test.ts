import { describe, expect, it } from "vitest";
import {
  MEMORY_CAPTURE_POLL_MAX_MS,
  MEMORY_CAPTURE_POLL_MS,
} from "@/constants/memory";
import { capturePoll } from "@/lib/memory/capture-poll";

describe("capturePoll", () => {
  it("stops reading once nothing is pending", () => {
    expect(capturePoll({ pending: 0, since: null, now: 1_000 })).toEqual({
      interval: false,
      since: null,
    });
  });

  it("keeps reading while a capture is pending, and opens the window on the first read", () => {
    expect(capturePoll({ pending: 1, since: null, now: 1_000 })).toEqual({
      interval: MEMORY_CAPTURE_POLL_MS,
      since: 1_000,
    });
  });

  it("carries the window's start, so the ceiling measures the whole burst", () => {
    // The window opens at 1000 and is still open at 2000: the clock must stay
    // 1000, or every read would restart the budget and the ceiling would never
    // be reached.
    expect(capturePoll({ pending: 2, since: 1_000, now: 2_000 })).toEqual({
      interval: MEMORY_CAPTURE_POLL_MS,
      since: 1_000,
    });
  });

  it("stops at the ceiling and clears the window", () => {
    // Clearing it is what lets a later save start a fresh burst: the ceiling
    // bounds one backlog, not the tab's whole lifetime.
    expect(
      capturePoll({
        pending: 1,
        since: 1_000,
        now: 1_000 + MEMORY_CAPTURE_POLL_MAX_MS,
      }),
    ).toEqual({ interval: false, since: null });
  });
});
