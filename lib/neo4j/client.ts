import "server-only";
import neo4j, { Driver } from "neo4j-driver";
import { logger } from "@/lib/logger";
import { getNeo4jSettings, isNeo4jConfigured } from "./config";

let driver: Driver | null = null;

export function getDriver(): Driver | null {
  if (driver) return driver;
  const settings = getNeo4jSettings();
  if (!settings) return null;

  driver = neo4j.driver(
    settings.uri,
    neo4j.auth.basic(settings.user, settings.password),
    {
      maxTransactionRetryTime: settings.maxTransactionRetryTime,
      connectionTimeout: settings.connectionTimeoutMs,
      // Counts and ids come back as plain numbers rather than `Integer` objects,
      // which would otherwise need `toNumber()` at every traversal call site.
      disableLosslessIntegers: true,
    },
  );

  return driver;
}

export async function getNeo4jDriver(): Promise<Driver> {
  const existing = getDriver();
  if (!existing) {
    throw new Error("Neo4j is not configured (NEO4J_URI or NEO4J_PASSWORD is unset)");
  }
  return existing;
}

export async function verifyNeo4jConnectivity(): Promise<boolean> {
  const existing = getDriver();
  if (!existing) return false;
  try {
    await existing.verifyConnectivity();
    return true;
  } catch (error) {
    logger.error({ err: error }, "Neo4j connectivity check failed");
    return false;
  }
}

export async function closeNeo4jDriver(): Promise<void> {
  if (!driver) return;
  const closing = driver;
  driver = null;
  await closing.close();
}

export { isNeo4jConfigured };
