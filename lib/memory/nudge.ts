import "server-only";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { sweepUser } from "./sweep-runner";

/**
 * Schedule one sweep for this user after the current response is finished.
 *
 * Called at both capture write sites, and never awaited. It never throws: the
 * capture it follows is already durable, so a nudge that cannot be scheduled
 * must cost the response nothing. `after` is the right primitive because the app
 * self-hosts a Node server, where the callback is kept alive past the response
 * and drained on shutdown — a bare detached promise has no such guarantee.
 *
 * This removes the wait; it does not replace the driver. The external cron stays
 * the retry for a capture whose extraction failed or whose nudge never ran.
 */
export function nudgeMemorySweep(userId: string): void {
  const run = () => {
    void sweepUser(userId).catch((error) => {
      logger.error({ err: error, userId }, "Nudged memory sweep failed");
    });
  };

  try {
    after(run);
  } catch (error) {
    // No request scope to attach to. Run detached instead; the cron covers it if
    // the process ends first.
    logger.warn({ err: error, userId }, "Could not schedule memory sweep nudge");
    run();
  }
}
