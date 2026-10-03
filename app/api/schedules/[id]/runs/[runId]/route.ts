import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ScheduleStore } from "@/lib/mongodb/schedule-store";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

type RouteParams = { params: Promise<{ id: string; runId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const { id, runId } = await params;
    const run = await scheduleStore.getRun(runId, user.id);

    // The nested path is a convenience for the UI, which knows both ids; the
    // `scheduleId` comparison is what stops it being a way to read a run through
    // the wrong schedule's URL. `userId` on the read is the actual boundary.
    if (!run || run.scheduleId !== id) return api.notFound("Run");

    return api.success(run);
  } catch (error) {
    return handleError(error, "Fetch schedule run");
  }
}
