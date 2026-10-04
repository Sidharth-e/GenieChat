import "server-only";
import {
  MEMORY_CAPTURE_MAX_ATTEMPTS,
  MEMORY_SWEEP_USER_LIMIT,
} from "@/constants/memory";
import { logger } from "@/lib/logger";
import { getNeo4jDriver } from "@/lib/neo4j/client";
import { SWEEP_WORKLIST_CYPHER } from "./cypher";
import { MemoryGraphStore } from "./graph-store";
import { createSingleFlight } from "./single-flight";
import type { SweepSummary } from "./types";

/**
 * What one pass covered. `users` is the worklist size, `touched` how many had
 * something to do, `failed` how many errored — the three are different numbers
 * and an operator reading a cron log needs all of them.
 */
export interface SweepPassResult {
  users: number;
  touched: number;
  failed: number;
  summary: SweepSummary;
}

// Module-level: the nudge and the cron pass share this store and this map, so a
// concurrent sweep of one user joins rather than running twice.
const store = new MemoryGraphStore();
const sweepsInFlight = createSingleFlight<SweepSummary>();

/**
 * One user's sweep, deduped against any sweep already running for them.
 *
 * This is the single entry point both callers use: the nudge after a capture,
 * and `runSweepPass` for the cron. That is what stops the two from extracting
 * the same capture twice — the race is a doubled model call and either a
 * duplicate current fact or a supersede churn over a fact just written.
 */
export function sweepUser(userId: string): Promise<SweepSummary> {
  return sweepsInFlight.run(userId, () => store.sweep(userId));
}

/**
 * One sweep pass, over every user with outstanding work.
 *
 * The worklist is users who have a pending `:Capture` or a vectorless `:Fact`,
 * not every user: a user with nothing pending costs two index reads to discover
 * that, so "every user" would make the pass scale with the user table rather
 * than with the backlog. `MEMORY_SWEEP_USER_LIMIT` caps how many one pass
 * touches, which makes a run a drip rather than a thundering herd.
 *
 * One user's failure must not stop the others. The next run picks the work back
 * up — the capture is still on disk, and a fact without a vector is still
 * recallable through the lexical-free seed path once it has one — so a failed
 * user is counted and skipped rather than rethrown.
 */
export async function runSweepPass(): Promise<SweepPassResult> {
  const driver = await getNeo4jDriver();
  const worklist = await driver.executeQuery(SWEEP_WORKLIST_CYPHER, {
    maxAttempts: MEMORY_CAPTURE_MAX_ATTEMPTS,
    limit: MEMORY_SWEEP_USER_LIMIT,
  });

  const summary: SweepSummary = {
    captures: 0,
    reconciled: 0,
    merged: 0,
    embedded: 0,
  };
  let touched = 0;
  let failed = 0;

  for (const record of worklist.records) {
    const userId = String(record.get("userId") ?? "");
    if (!userId) continue;

    try {
      const pass = await sweepUser(userId);
      summary.captures += pass.captures;
      summary.reconciled += pass.reconciled;
      summary.merged += pass.merged;
      summary.embedded += pass.embedded;

      const didWork =
        pass.captures + pass.reconciled + pass.merged + pass.embedded > 0;
      if (didWork) {
        touched += 1;
        logger.info({ userId, ...pass }, "Memory sweep");
      }
    } catch (error) {
      failed += 1;
      logger.error({ err: error, userId }, "Memory sweep failed for user");
    }
  }

  return { users: worklist.records.length, touched, failed, summary };
}
