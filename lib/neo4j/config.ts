import { config } from "@/lib/config";

export interface Neo4jSettings {
  uri: string;
  user: string;
  password: string;
  maxTransactionRetryTime: number;
  connectionTimeoutMs: number;
}

/**
 * Null unless the URI *and* a password are present. A URI with no password is
 * not a usable configuration — it would fail auth on every call — so it is
 * reported as unconfigured rather than as a reachable store that always errors.
 */
export function getNeo4jSettings(): Neo4jSettings | null {
  const { uri, user, password, maxTransactionRetryTime, connectionTimeoutMs } =
    config.neo4j;
  if (!uri || !password) return null;
  return { uri, user, password, maxTransactionRetryTime, connectionTimeoutMs };
}

export function isNeo4jConfigured(): boolean {
  return getNeo4jSettings() !== null;
}
