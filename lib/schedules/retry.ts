import {
  SCHEDULE_BACKOFF_BASE_MS,
  SCHEDULE_BACKOFF_CAP_MS,
  SCHEDULE_TERMINAL_ERROR_CODES,
} from "@/constants/schedules";
import type { ScheduleRun, ScheduleRunStatus } from "@/lib/types";

/** Fraction of the nominal delay that jitter may add or remove. */
const JITTER = 0.2;

/**
 * Exponential backoff with jitter, capped.
 *
 * Jitter is injected rather than reached for, because `Math.random()` inside
 * would make every assertion about this curve a range check and the exact
 * expectations in the suite impossible.
 */
export function backoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const nominal = Math.min(
    SCHEDULE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
    SCHEDULE_BACKOFF_CAP_MS,
  );
  const offset = nominal * JITTER * (random() * 2 - 1);
  return Math.max(0, Math.round(nominal + offset));
}

export function isTerminalErrorCode(code: string): boolean {
  return (SCHEDULE_TERMINAL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * The delay before the next attempt, or `null` when there must not be one.
 *
 * `null` is the whole contract: it means the run is finished, and the caller
 * marks it `failed` rather than scheduling a retry. A terminal code returns
 * `null` regardless of remaining attempts, because retrying "the target was
 * deleted" only spends model calls to reach the same answer.
 */
export function nextAttemptDelayMs(
  attempt: number,
  code: string,
  random: () => number = Math.random,
): number | null {
  if (isTerminalErrorCode(code)) return null;
  return backoffMs(attempt, random);
}

/** The error every reaped run carries. Retryable: the process died, not the target. */
const LEASE_EXPIRED = {
  code: "lease_expired",
  message: "The run's lease expired before it finished.",
  retryable: true,
} as const;

/**
 * What a lapsed lease becomes. Structurally the store's success-less
 * `SettleOutcome`, but declared here so this module stays free of the store's
 * I/O module graph.
 */
export type LapsedLeaseOutcome =
  | { status: "pending"; nextAttemptAt: string; error: ScheduleRun["error"] }
  | { status: "failed"; error: ScheduleRun["error"] };

/**
 * Decides what happens to a run whose lease lapsed, as a pure function.
 *
 * Here rather than in the store because it is retry policy, and because the
 * store's module graph reaches `lib/env` — a pure decision that can only be
 * unit-tested by stubbing a database URI first is a decision in the wrong file.
 *
 * The boundary is the whole point: `attempt` is incremented *by the claim*, so a
 * run already at `attempt === maxAttempts` has used its last permitted attempt
 * and must fail. Handing it back instead would retry forever.
 */
export function reaperOutcome(
  run: Pick<ScheduleRun, "attempt" | "maxAttempts">,
  now: Date,
  random: () => number = Math.random,
): LapsedLeaseOutcome {
  if (run.attempt >= run.maxAttempts) {
    return { status: "failed", error: LEASE_EXPIRED };
  }

  return {
    status: "pending",
    nextAttemptAt: new Date(
      now.getTime() + backoffMs(run.attempt, random),
    ).toISOString(),
    error: LEASE_EXPIRED,
  };
}

/**
 * Whether a run may still change on its own.
 *
 * The UI polls while this is true and stops when it is false, so the terminal
 * set has to be complete: `skipped` and `cancelled` never execute, and a run the
 * user cancelled that kept the poller alive would leave the page loading forever.
 * It lives beside the retry curve because it is the same state machine read from
 * the other end -- `reaperOutcome` decides which terminal state a run reaches.
 */
export function isRunOpen(status: ScheduleRunStatus): boolean {
  return status === "pending" || status === "running";
}
