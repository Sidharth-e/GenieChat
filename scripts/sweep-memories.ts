/**
 * One sweep pass, asked for by hand.
 *
 * The sweep runs inside the app, at `POST /api/memories/sweep`, because the
 * pass that has to run first — `extractPendingCaptures` — is a
 * `MemoryGraphStore` method and the store carries the `"server-only"` guard,
 * which Next aliases at build time and `tsx` does not resolve at all. So this
 * script is a caller rather than the sweep itself, exactly like the compose
 * `memory-sweep` sidecar: same endpoint, same `CRON_SECRET` bearer.
 *
 * It is a convenience, not the driver. A deployment points a real cron at the
 * endpoint; `APP_URL` is only how the script finds a running app to call, and it
 * defaults to the dev server.
 */
import { logger } from "@/lib/logger";

const DEFAULT_APP_URL = "http://localhost:3000";

async function main() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error("CRON_SECRET is not set; the sweep endpoint would answer 401");
    process.exit(1);
  }

  const baseUrl = process.env.APP_URL ?? DEFAULT_APP_URL;
  const url = `${baseUrl.replace(/\/$/, "")}/api/memories/sweep`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const body = await response.text();

  if (!response.ok) {
    // The body carries the reason — an unset secret, an unconfigured Neo4j, a
    // store failure — and a bare status code would hide which one it was.
    logger.error(`Memory sweep failed (HTTP ${response.status}): ${body}`);
    process.exit(1);
  }

  logger.info(`Memory sweep complete: ${body}`);
}

main().catch((error) => {
  logger.error({ err: error }, "Memory sweep crashed");
  process.exit(1);
});
