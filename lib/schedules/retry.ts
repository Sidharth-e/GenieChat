import {
  SCHEDULE_BACKOFF_BASE_MS,
  SCHEDULE_BACKOFF_CAP_MS,
  SCHEDULE_TERMINAL_ERROR_CODES,
} from "@/constants/schedules";

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
