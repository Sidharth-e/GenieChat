import { config } from "@/lib/config";

export interface PostgresSettings {
  url: string;
  poolMax: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/** Returns the Postgres settings, or null when POSTGRES_URL is unset. */
export function getPostgresSettings(): PostgresSettings | null {
  const { url, poolMax, idleTimeoutMillis, connectionTimeoutMillis } =
    config.postgres;
  if (!url) return null;
  return { url, poolMax, idleTimeoutMillis, connectionTimeoutMillis };
}
