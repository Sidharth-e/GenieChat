import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { config } from "@/lib/config";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ScheduleStore } from "@/lib/mongodb/schedule-store";
import { nextRunAtISO } from "@/lib/schedules/cadence";
import { getExecutor } from "@/lib/schedules/executors";
import {
  describeTargetError,
  parseScheduleDraft,
} from "@/lib/schedules/schedule-input";
import type { TriggerTargetType } from "@/lib/types";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

/** Reading a string param, treating an empty one as absent. */
function optionalParam(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const params = request.nextUrl.searchParams;
    const enabled = optionalParam(params.get("enabled"));

    const schedules = await scheduleStore.getSchedules(user.id, {
      // Only `"true"` and `"false"` are filters. Anything else -- including the
      // empty string `?enabled=` -- is an absent filter rather than a filter that
      // matches nothing, or a bad query string would return an empty list instead
      // of the user's schedules.
      enabled: enabled === "true" ? true : enabled === "false" ? false : undefined,
      targetType: optionalParam(params.get("target.type")) as
        | TriggerTargetType
        | undefined,
      targetId: optionalParam(params.get("target.id")),
    });

    // Target names are resolved per schedule rather than joined, because a target
    // can be an agent or a workflow and there is no shared collection to join
    // against. `describe` returns null for a target that is gone -- the schedule
    // still lists, showing its own stored name, rather than failing the whole read
    // over one deleted agent.
    const withNames = await Promise.all(
      schedules.map(async (schedule) => {
        const target = await getExecutor(schedule.target.type)?.describe(
          user.id,
          schedule.target.id,
        );
        return target ? { ...schedule, targetName: target.name } : schedule;
      }),
    );

    return api.success(withNames);
  } catch (error) {
    return handleError(error, "List schedules");
  }
}

export async function POST(request: NextRequest) {
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

    const now = new Date();
    const parsed = parseScheduleDraft(await request.json(), now);
    if (!parsed.ok) return api.badRequest(parsed.message);
    const draft = parsed.value;

    // The executor is fetched twice on this path -- once here, once for
    // `validate`, which fetches it again internally. That is deliberate: this
    // lookup is what turns "a target type nobody can run yet" into a save-time
    // error rather than a run that fails at 3am, and `getExecutor` is a Map read.
    const executor = getExecutor(draft.target.type);
    if (!executor) return api.badRequest(describeTargetError("invalid_target"));

    const ownership = await executor.validate(user.id, draft.target.id);
    if (!ownership.ok) return api.badRequest(describeTargetError(ownership.code));

    // The executor's own schema is the only authority on what its input may be, so
    // it is asked here rather than the scheduler guessing at shapes. Storing the
    // *parsed* value, not the raw one, is what makes the stored input already
    // valid at run time -- an executor's parse in `execute` then has nothing to
    // reject.
    const input = executor.inputSchema.safeParse(draft.input);
    if (!input.success) {
      const first = input.error.issues[0];
      return api.badRequest(
        first ? `That input is not valid: ${first.message}` : "That input is not valid.",
      );
    }

    const schedule = await scheduleStore.createSchedule({
      userId: user.id,
      ...draft,
      input: input.data,
      nextRunAt: nextRunAtISO(draft.cadence, now),
    });

    return api.created(schedule);
  } catch (error) {
    return handleError(error, "Create schedule");
  }
}
