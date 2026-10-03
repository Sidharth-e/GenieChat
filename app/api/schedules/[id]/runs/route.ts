import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { boundedInt } from "@/lib/api/query-params";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ScheduleStore } from "@/lib/mongodb/schedule-store";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!scheduleStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    // Existence first, so a paginated read of somebody else's schedule answers 404
    // rather than an empty page -- which would be indistinguishable from a
    // schedule with no history yet.
    const schedule = await scheduleStore.getSchedule(id, user.id);
    if (!schedule) return api.notFound("Schedule");

    const query = request.nextUrl.searchParams;
    // `min: 1` on the limit: an absent param and an explicit `0` both have to
    // become a page, because the store passes this straight to `.limit()`, where
    // `0` means no limit at all.
    const limit = boundedInt(query.get("limit"), {
      fallback: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    });
    const offset = boundedInt(query.get("offset"), {
      fallback: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });

    const [runs, total] = await Promise.all([
      scheduleStore.getRuns(id, user.id, limit, offset),
      scheduleStore.countRuns(id, user.id),
    ]);

    return api.success({ runs, total });
  } catch (error) {
    return handleError(error, "List schedule runs");
  }
}
