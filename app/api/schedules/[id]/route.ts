import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { config } from "@/lib/config";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ScheduleStore, type ScheduleUpdate } from "@/lib/mongodb/schedule-store";
import { getExecutor } from "@/lib/schedules/executors";
import {
  describeTargetError,
  nextRunAtAfterPatch,
  parseSchedulePatch,
} from "@/lib/schedules/schedule-input";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const schedule = await scheduleStore.getSchedule(id, user.id);
    // 404 for both "no such schedule" and "not yours". The store scopes by
    // `userId`, so the two are indistinguishable here -- which is the right
    // answer, because telling a caller which ids exist is the cross-user read the
    // scoping exists to prevent.
    if (!schedule) return api.notFound("Schedule");

    const target = await getExecutor(schedule.target.type)?.describe(
      user.id,
      schedule.target.id,
    );
    return api.success(target ? { ...schedule, targetName: target.name } : schedule);
  } catch (error) {
    return handleError(error, "Fetch schedule");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "schedules_write",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;
    const current = await scheduleStore.getSchedule(id, user.id);
    if (!current) return api.notFound("Schedule");

    const now = new Date();
    const parsed = parseSchedulePatch(await request.json(), now);
    if (!parsed.ok) return api.badRequest(parsed.message);
    const patch = parsed.value;

    // A patch that changes the target, or the input with it, has to be re-checked
    // against the executor it will now run under -- otherwise a schedule could be
    // repointed at an agent the caller does not own, or given an input its target
    // cannot accept, by an update rather than by a create.
    const target = patch.target ?? current.target;
    const executor = getExecutor(target.type);
    if (!executor) return api.badRequest(describeTargetError("invalid_target"));

    if (patch.target) {
      const ownership = await executor.validate(user.id, target.id);
      if (!ownership.ok) return api.badRequest(describeTargetError(ownership.code));
    }

    const updates: ScheduleUpdate = { ...patch };

    if (patch.input !== undefined || patch.target) {
      const candidate = patch.input !== undefined ? patch.input : current.input;
      const input = executor.inputSchema.safeParse(candidate);
      if (!input.success) {
        const first = input.error.issues[0];
        return api.badRequest(
          first
            ? `That input is not valid: ${first.message}`
            : "That input is not valid.",
        );
      }
      updates.input = input.data;
    }

    // `nextRunAt` is computed from `current`, the document as it stands now --
    // not from the patch -- because the two things that move it (a new cadence,
    // and resuming a paused schedule) are both defined against what the schedule
    // was, and `nextRunAtAfterPatch` is where that decision is made and tested.
    const next = nextRunAtAfterPatch(now, current, patch);
    if (next.update) updates.nextRunAt = next.nextRunAt;

    const updated = await scheduleStore.updateSchedule(id, user.id, updates);
    if (!updated) return api.notFound("Schedule");
    return api.success(updated);
  } catch (error) {
    return handleError(error, "Update schedule");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const deleted = await scheduleStore.deleteSchedule(id, user.id);
    if (!deleted) return api.notFound("Schedule");
    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete schedule");
  }
}
