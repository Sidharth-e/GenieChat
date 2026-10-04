import { NextRequest } from "next/server";
import { api, handleError } from "@/lib/api-utils";
import { checkCronSecret } from "@/lib/api/cron-guard";
import { runSweepPass } from "@/lib/memory/sweep-runner";
import { isNeo4jConfigured } from "@/lib/neo4j/client";

/**
 * The memory sweep's pulse: one authenticated request that runs one pass.
 *
 * The sweep is a periodic worker — captures waiting to be extracted,
 * reconciliation, the predicate merge, the vectorless backfill — and it lives
 * here for the same reason the schedule tick does: nothing in this app runs on a
 * timer of its own, so the driver is whatever sends this request. A `tsx` script
 * could not do the job, because the pass it must run first,
 * `extractPendingCaptures`, is a `MemoryGraphStore` method and the store carries
 * the `"server-only"` guard, which does not resolve outside the Next build.
 *
 * The route is listed in `proxy.ts`'s `publicPaths`, so it is reached without a
 * session and the bearer secret below is the only thing guarding it. Failing
 * closed matters: an unset secret answers 401 and never falls through to
 * sweeping unauthenticated.
 */
async function handle(request: NextRequest) {
  try {
    const denied = checkCronSecret(request);
    if (denied) return denied;

    if (!isNeo4jConfigured()) {
      return api.serviceUnavailable("Neo4j not configured");
    }

    // The counts are the point: a cron log is the only place an operator sees
    // what a pass did, so "12 users, 3 touched, 1 failed" has to be in the body.
    const result = await runSweepPass();
    return api.success({ success: true, ...result });
  } catch (error) {
    return handleError(error, "Memory sweep");
  }
}

// Both verbs, for the same reason the tick takes both: external schedulers are
// not consistent about which they issue, and a pass is idempotent-by-worklist
// rather than by method — a second pass over a drained backlog does nothing.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
