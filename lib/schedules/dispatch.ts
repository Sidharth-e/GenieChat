import "server-only";
import { ScheduleStore } from "@/lib/mongodb/schedule-store";
import { executeClaimedRun } from "@/lib/schedules/tick";

export type DispatchOutcome =
  | { dispatched: true; outcome: "executed" | "retried" | "failed" }
  | { dispatched: false; reason: "not_claimed" };

/**
 * Claims one run by id and runs it to a settlement.
 *
 * Two callers, one shape. `POST /api/schedules/[id]/run` creates a run and calls
 * this *detached*, because a model call must not sit inside a response the user
 * is waiting on; if this process dies before the claim, the run is still `pending`
 * and the next tick's phase 4 picks it up. `POST /api/schedules/execute/[runId]`
 * calls it and waits, because its caller is an external worker whose whole job is
 * to drive that run.
 *
 * `not_claimed` is a success, not an error. It means the run is no longer
 * `pending` -- already claimed by a tick, already settled, or claimed by the
 * other of two racing dispatchers -- which is exactly what the loser should be
 * told. Answering it as a failure would have the worker retry a run that is
 * already running.
 *
 * `userId` is optional because only one caller has a session: the cron route has
 * none to scope by, and its credential is the secret plus an unguessable run id.
 * The session route passes it, so a user cannot dispatch another user's run.
 */
export async function dispatchRunById(
  runId: string,
  now: Date = new Date(),
  userId?: string,
): Promise<DispatchOutcome> {
  const store = new ScheduleStore();
  const run = await store.claimRunById(runId, now.toISOString(), userId);
  if (!run) return { dispatched: false, reason: "not_claimed" };
  return { dispatched: true, outcome: await executeClaimedRun(store, run, now) };
}
