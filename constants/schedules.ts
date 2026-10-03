/**
 * Scheduling limits and defaults.
 *
 * The tick's whole reliability story is these numbers, so each one states the
 * constraint it is derived from rather than being a round figure someone liked.
 */

/**
 * How long a claimed run owns its work before another tick may take it back.
 *
 * This is the at-least-once boundary, so it trades two failures against each
 * other: too short and a live-but-slow run is reclaimed and executed twice; too
 * long and a run whose process died waits to be retried. Five minutes is longer
 * than a model turn and short enough that a killed serverless invocation is
 * retried within the hour even at a one-minute tick.
 */
export const SCHEDULE_LEASE_MS = 5 * 60_000;

/**
 * How often a running tick extends its own leases. Must be a comfortable
 * fraction of `SCHEDULE_LEASE_MS`, or a run is reclaimed while it is still
 * alive because renewal came too late.
 */
export const SCHEDULE_LEASE_RENEW_MS = 60_000;

/**
 * Past this, the tick stops renewing and lets the reaper fail the run as timed
 * out. Not a hard abort: the underlying generator keeps running until it
 * finishes, which "Honest limitations" in the spec states plainly.
 */
export const SCHEDULE_RUN_TIMEOUT_MS = 10 * 60_000;

/** Due schedules claimed per tick. Bounds one tick's work so a backlog drains across ticks rather than in one long request. */
export const SCHEDULE_TICK_CLAIM_LIMIT = 50;

/** Due runs claimed and executed per tick, oldest first. */
export const SCHEDULE_TICK_RUN_LIMIT = 50;

/** In-flight runs per tick. Bounded because each run holds a model connection. */
export const SCHEDULE_TICK_CONCURRENCY = 4;

/** First retry delay. Long enough to clear a transient provider blip. */
export const SCHEDULE_BACKOFF_BASE_MS = 30_000;

/** Backoff ceiling. Past this, waiting longer is worse than failing and letting the user see it. */
export const SCHEDULE_BACKOFF_CAP_MS = 30 * 60_000;

/** Default attempts per run, overridable per schedule. */
export const SCHEDULE_DEFAULT_MAX_ATTEMPTS = 3;

/** How long run records are kept. Backs the `expiresAt` TTL index. */
export const SCHEDULE_RUN_RETENTION_DAYS = 90;

/**
 * Errors that exhaust attempts immediately.
 *
 * These are outcomes a retry cannot change: the target is gone, the caller does
 * not own it, or the input does not validate. Retrying them burns three model
 * calls to arrive at the same answer. Everything else — a provider 429, a
 * network reset, an expired lease — is retryable.
 */
export const SCHEDULE_TERMINAL_ERROR_CODES = [
  "target_not_found",
  "unauthorized",
  "invalid_input",
  "invalid_target",
] as const;

export type ScheduleTerminalErrorCode =
  (typeof SCHEDULE_TERMINAL_ERROR_CODES)[number];

/**
 * The ceiling on a per-schedule attempt count.
 *
 * A lower bound exists because `0` is falsy: the tick reads
 * `schedule.maxAttempts || SCHEDULE_DEFAULT_MAX_ATTEMPTS`, so a stored `0`
 * silently becomes 3 rather than meaning "no retries". An upper bound exists
 * because a target that fails every time would otherwise retry for days at one
 * model call per attempt -- three attempts is a working default and ten is
 * already generous.
 */
export const SCHEDULE_MAX_ATTEMPTS = 10;

/**
 * The runtime lists behind `lib/types.ts`'s unions.
 *
 * The unions are the type; these are what a request body can be validated
 * against, because a type is gone at runtime. `tests/lib/schedules/schedule-input.test.ts`
 * pins each list against its union, so a new member added to one and not the
 * other fails a test rather than silently rejecting the new value.
 */
export const SCHEDULE_TARGET_TYPES = ["workflow", "agent", "tool"] as const;
export const SCHEDULE_OVERLAP_POLICIES = ["skip", "allow"] as const;
export const SCHEDULE_CATCH_UP_POLICIES = ["skip", "once"] as const;
