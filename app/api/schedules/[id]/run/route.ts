import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { config } from "@/lib/config";
import { SCHEDULE_DEFAULT_MAX_ATTEMPTS } from "@/constants/schedules";
import { logger } from "@/lib/logger";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { runExpiryFrom, ScheduleStore } from "@/lib/mongodb/schedule-store";
import { dispatchRunById } from "@/lib/schedules/dispatch";
import { getExecutor } from "@/lib/schedules/executors";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "schedule_run_now",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;
    const schedule = await scheduleStore.getSchedule(id, user.id);
    if (!schedule) return api.notFound("Schedule");

    const now = new Date();
    const executor = getExecutor(schedule.target.type);

    // The target's name is stamped onto the run, so history survives the target
    // being renamed or deleted. A null name is fine -- the run still records the
    // id it ran against.
    const described = executor
      ? await executor.describe(user.id, schedule.target.id)
      : null;

    const run = await scheduleStore.createRun({
      scheduleId: schedule.id,
      userId: schedule.userId,
      target: {
        type: schedule.target.type,
        id: schedule.target.id,
        ...(described ? { name: described.name } : {}),
      },
      trigger: "manual",
      // "Now" is the scheduled instant for a manual run: there is no occurrence
      // being claimed, and history reads better showing when the user pressed the
      // button than a cadence-derived time that was never used.
      scheduledFor: now.toISOString(),
      status: "pending",
      attempt: 0,
      maxAttempts: schedule.maxAttempts || SCHEDULE_DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: now.toISOString(),
      leaseExpiresAt: null,
      expiresAt: runExpiryFrom(now),
    });

    // Detached, and deliberately so: a model call must not be inside a response
    // the user is waiting on, and the run is already durable. `userId` is passed
    // so the claim cannot be taken for a run belonging to somebody else. If the
    // process dies before the claim lands, the run stays `pending` and the next
    // tick's phase 4 picks it up -- the same at-least-once guarantee every other
    // run gets. `overlapPolicy` is ignored here: the user asked for this run, so
    // skipping it would be the surprising answer.
    void dispatchRunById(run.id, now, user.id).catch((error) =>
      logger.error({ err: error, runId: run.id }, "manual schedule dispatch failed"),
    );

    return api.success({ runId: run.id }, 202);
  } catch (error) {
    return handleError(error, "Run schedule now");
  }
}
