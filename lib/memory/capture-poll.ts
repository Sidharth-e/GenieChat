import {
  MEMORY_CAPTURE_POLL_MAX_MS,
  MEMORY_CAPTURE_POLL_MS,
} from "@/constants/memory";

/**
 * Whether the memory list should read again, and the clock the current burst
 * started on.
 *
 * The pending count is the whole signal: a capture the sweep has materialized —
 * or one whose attempts are spent — leaves the pending set, so the poll ends
 * because the work ended rather than because a guessed window expired. The clock
 * is carried across calls rather than held here, which keeps this pure: the
 * caller owns the ref, and the decision is testable without a timer.
 */
export interface CapturePollInput {
  /** Pending captures the last read reported. */
  pending: number;
  /** When the current burst started, or null when none is running. */
  since: number | null;
  /** The current clock, injected rather than read. */
  now: number;
}

export interface CapturePoll {
  /** The delay before the next read, or `false` to stop. */
  interval: number | false;
  /** The clock to carry into the next decision. */
  since: number | null;
}

export function capturePoll({ pending, since, now }: CapturePollInput): CapturePoll {
  if (pending <= 0) return { interval: false, since: null };

  const started = since ?? now;
  // Clearing the clock at the ceiling, rather than keeping the spent one, is
  // what lets a later save open a fresh burst: the ceiling bounds one backlog,
  // not the tab's whole lifetime.
  if (now - started >= MEMORY_CAPTURE_POLL_MAX_MS) {
    return { interval: false, since: null };
  }

  return { interval: MEMORY_CAPTURE_POLL_MS, since: started };
}
