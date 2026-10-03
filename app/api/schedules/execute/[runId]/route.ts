import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkCronSecret } from "@/lib/api/cron-guard";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { dispatchRunById } from "@/lib/schedules/dispatch";

type RouteParams = { params: Promise<{ runId: string }> };

/**
 * The dispatch seam: run one named run, now.
 *
 * Nothing in the app calls this. Phase 1's tick executes runs itself, and so does
 * "Run now"; this route exists so a *different* execution model is a driver
 * change rather than a code change -- an external worker can be handed run ids
 * and drive them here, on a box with more memory or a longer timeout than the
 * thing serving web requests.
 *
 * Authenticated by `CRON_SECRET`, not a session, because its caller is a worker.
 * That is the whole gate: the route skips the session proxy in `proxy.ts`, and
 * the run id is an unguessable uuidv7.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const denied = checkCronSecret(request);
    if (denied) return denied;
    if (!isDatabaseConfigured()) {
      return api.serviceUnavailable("Database not configured");
    }

    const { runId } = await params;
    const outcome = await dispatchRunById(runId);

    // `not_claimed` comes back as a success with `dispatched: false` rather than
    // an error, because it is the correct answer for the second of two racing
    // dispatchers and for a run already settled. A worker that received an error
    // would retry a run that is already running.
    return api.success({ success: true, ...outcome });
  } catch (error) {
    return handleError(error, "Dispatch schedule run");
  }
}
