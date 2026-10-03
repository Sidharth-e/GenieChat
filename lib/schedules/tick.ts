// Registers the workflow executor. A side-effect import rather than a call into
// `registry.ts`, because `registry.ts` importing the executor would be a cycle —
// the executor imports the registry. Without this line at the top of the tick's
// module graph the registry is empty at runtime, every schedule answers
// `invalid_target`, and neither the type-check nor the unit suite would notice.
import "@/lib/schedules/executor-workflow";
import { ScheduleStore, runExpiryFrom } from "@/lib/mongodb/schedule-store";
import { nextAttemptDelayMs } from "@/lib/schedules/retry";
import { getExecutor } from "@/lib/schedules/registry";
import {
  SCHEDULE_DEFAULT_MAX_ATTEMPTS,
  SCHEDULE_LEASE_MS,
  SCHEDULE_LEASE_RENEW_MS,
  SCHEDULE_RUN_TIMEOUT_MS,
  SCHEDULE_TICK_CLAIM_LIMIT,
  SCHEDULE_TICK_CONCURRENCY,
  SCHEDULE_TICK_RUN_LIMIT,
} from "@/constants/schedules";
import { logger } from "@/lib/logger";
import type { ScheduleRun } from "@/lib/types";

export interface TickSummary {
  reaped: number;
  claimed: number;
  created: number;
  executed: number;
  skipped: number;
  retried: number;
  failed: number;
}

/**
 * One pass of the scheduler. Every path through the system runs through here —
 * the HTTP endpoint is only a driver for this call, which is what lets the same
 * code run on a container, a serverless function or a laptop.
 *
 * `now` is a parameter rather than a read of the clock so a test or a backfill
 * can place the whole pass at a single instant: every phase below must agree on
 * what "due" means, and a pass that read the clock per phase could straddle the
 * boundary between two of them.
 */
export async function runTick(now: Date = new Date()): Promise<TickSummary> {
  const nowISO = now.toISOString();
  const store = new ScheduleStore();
  const summary: TickSummary = {
    reaped: 0,
    claimed: 0,
    created: 0,
    executed: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  };

  // 1. Reap. A run whose lease lapsed belongs to a process that died. This is
  // what makes serverless survivable: a killed invocation becomes a retry
  // rather than a lost run.
  summary.reaped = await store.reapExpiredLeases(nowISO);

  // 2. Claim due schedules. The pre-image's `nextRunAt` IS this run's
  // `scheduledFor` — no second read, and no window in which two tickers see the
  // same due schedule. Claiming also advances `nextRunAt` from `now`, so there
  // is deliberately no write of it below: a second one would be a redundant
  // round trip and a second place for the two values to disagree.
  const due = await store.claimDueSchedules(nowISO, SCHEDULE_TICK_CLAIM_LIMIT);
  summary.claimed = due.length;

  for (const schedule of due) {
    const scheduledFor = schedule.nextRunAt ?? nowISO;

    // 3. Overlap. `skip` counts rather than inserts: a schedule firing every
    // minute with a run in flight would otherwise grow history without bound.
    if (
      schedule.overlapPolicy === "skip" &&
      (await store.hasOpenRun(schedule.id))
    ) {
      await store.markSkipped(schedule.id, nowISO);
      summary.skipped += 1;
    } else {
      await store.createRun({
        scheduleId: schedule.id,
        userId: schedule.userId,
        target: schedule.target,
        trigger: "schedule",
        scheduledFor,
        status: "pending",
        attempt: 0,
        maxAttempts: schedule.maxAttempts || SCHEDULE_DEFAULT_MAX_ATTEMPTS,
        nextAttemptAt: nowISO,
        leaseExpiresAt: null,
        // A real `Date`: the TTL index reads a BSON date, and an ISO string
        // would leave the index silently expiring nothing.
        expiresAt: runExpiryFrom(now),
      });
      summary.created += 1;
    }
  }

  // 4. Claim due runs, oldest first. This flip is the at-least-once boundary:
  // once it happens the run will execute, here or via the reaper.
  const runs = await store.claimDueRuns(nowISO, SCHEDULE_TICK_RUN_LIMIT);

  // 5. Execute with bounded concurrency. Retries need no second mechanism — a
  // run due for retry is due work this phase already found.
  for (let i = 0; i < runs.length; i += SCHEDULE_TICK_CONCURRENCY) {
    const batch = runs.slice(i, i + SCHEDULE_TICK_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((run) => executeOne(store, run, now)),
    );
    for (const outcome of outcomes) summary[outcome] += 1;
  }

  return summary;
}

/**
 * Runs one claimed run to a settlement.
 *
 * The schedule is loaded here rather than carried in from phase 2. That is a
 * correctness point, not a convenience: a run claimed in phase 4 may have been
 * created by an *earlier* tick — a retry, or a run the reaper handed back — so
 * the tick has no schedule in hand for it, and a phase-2 loop variable would
 * only ever cover the runs created in the same tick.
 *
 * The lease belongs to the tick, not the executor: renewal happens here and the
 * executor never learns leases exist, which is what keeps the registry interface
 * honest.
 */
async function executeOne(
  store: ScheduleStore,
  run: ScheduleRun,
  now: Date,
): Promise<"executed" | "retried" | "failed"> {
  const schedule = await store.getSchedule(run.scheduleId, run.userId);
  if (!schedule) {
    // The schedule was deleted between the claim and the run. Terminal: there
    // is nothing left to retry against.
    await store.settleRun(run.id, {
      status: "failed",
      error: {
        code: "target_not_found",
        message: "Schedule no longer exists",
        retryable: false,
      },
    });
    return "failed";
  }

  const executor = getExecutor(run.target.type);
  const renew = setInterval(() => {
    // Past the deadline renewal stops, and the reaper fails the run as timed
    // out. Not a hard abort: the generator keeps running until it finishes.
    if (
      Date.now() - new Date(run.startedAt ?? now).getTime() >
      SCHEDULE_RUN_TIMEOUT_MS
    ) {
      clearInterval(renew);
      return;
    }
    void store
      .renewLease(run.id, new Date(Date.now() + SCHEDULE_LEASE_MS).toISOString())
      .catch((error) => logger.error({ err: error }, "lease renewal failed"));
  }, SCHEDULE_LEASE_RENEW_MS);

  try {
    if (!executor) {
      throw Object.assign(new Error(`No executor for ${run.target.type}`), {
        code: "invalid_target",
      });
    }
    const result = await executor.execute({ ...run, schedule });
    await store.settleRun(run.id, {
      status: "succeeded",
      resultRef: result.resultRef,
    });
    return "executed";
  } catch (error) {
    const code = (error as { code?: string }).code ?? "provider_error";
    const message = error instanceof Error ? error.message : String(error);
    const delay = nextAttemptDelayMs(run.attempt, code);
    const exhausted = run.attempt >= run.maxAttempts;

    if (delay !== null && !exhausted) {
      await store.settleRun(run.id, {
        status: "pending",
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        error: { code, message, retryable: true },
      });
      return "retried";
    }

    await store.settleRun(run.id, {
      status: "failed",
      error: { code, message, retryable: delay !== null },
    });
    return "failed";
  } finally {
    clearInterval(renew);
  }
}
