import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkCronSecret } from "@/lib/api/cron-guard";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { runTick } from "@/lib/schedules/tick";

/**
 * The portable pulse: one authenticated request that runs one pass of the
 * scheduler.
 *
 * Nothing here knows what drives it. An external cron, a container's own timer
 * or a scheduled serverless invocation all reduce to "send this request", which
 * is what lets the deployment move without the scheduler changing.
 *
 * The route is listed in `proxy.ts`'s `publicPaths`, so it is reached without a
 * session and the bearer secret below is the only thing guarding it. That is the
 * design rather than an oversight: an external driver has no NextAuth session to
 * present. Failing closed matters for the same reason — an unset secret answers
 * 401 and never falls through to running a tick unauthenticated.
 */
async function handle(request: NextRequest) {
  try {
    const denied = checkCronSecret(request);
    if (denied) return denied;

    if (!isDatabaseConfigured()) {
      return api.serviceUnavailable("Database not configured");
    }

    // The summary is the point: an external cron log is the only place an
    // operator sees what a tick did, so "claimed 3, executed 2, retried 1"
    // has to be in the response body.
    const summary = await runTick();
    return api.success({ success: true, ...summary });
  } catch (error) {
    return handleError(error, "Schedule tick");
  }
}

// Both verbs: external schedulers are not consistent about which they issue, and
// a tick is idempotent-by-claim rather than by method — the atomic claim is what
// stops two passes running one occurrence twice, so the verb carries no
// safety of its own.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
