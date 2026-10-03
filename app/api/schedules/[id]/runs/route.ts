import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ScheduleStore } from "@/lib/mongodb/schedule-store";

const scheduleStore = isDatabaseConfigured() ? new ScheduleStore() : null;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type RouteParams = { params: Promise<{ id: string }> };

/** A query integer, clamped rather than rejected: a bad param gets a page, not a 400. */
function boundedInt(raw: string | null, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), max);
}

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
    const limit = boundedInt(query.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = boundedInt(query.get("offset"), 0, Number.MAX_SAFE_INTEGER);

    const [runs, total] = await Promise.all([
      scheduleStore.getRuns(id, user.id, limit, offset),
      scheduleStore.countRuns(id, user.id),
    ]);

    return api.success({ runs, total });
  } catch (error) {
    return handleError(error, "List schedule runs");
  }
}
