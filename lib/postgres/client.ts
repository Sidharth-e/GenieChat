import "server-only";
import { Pool } from "pg";
import { logger } from "@/lib/logger";
import { getPostgresSettings } from "./config";

let pool: Pool | null = null;

/** The shared pool, or null when Postgres is not configured. */
export function getPool(): Pool | null {
  if (pool) return pool;
  const settings = getPostgresSettings();
  if (!settings) return null;

  pool = new Pool({
    connectionString: settings.url,
    max: settings.poolMax,
    idleTimeoutMillis: settings.idleTimeoutMillis,
    connectionTimeoutMillis: settings.connectionTimeoutMillis,
  });

  // A pool-level error would otherwise crash the process: node-postgres emits
  // "error" on the pool for failures on idle clients that no caller is awaiting.
  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected error on idle Postgres client");
  });

  return pool;
}

/** The shared pool, connecting lazily. Throws when Postgres is unconfigured. */
export async function getPostgresClient(): Promise<Pool> {
  const existing = getPool();
  if (!existing) {
    throw new Error("PostgreSQL is not configured (POSTGRES_URL is unset)");
  }
  return existing;
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}
