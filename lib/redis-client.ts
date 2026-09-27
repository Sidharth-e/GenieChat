import "server-only";

import Redis from "ioredis";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Shared Redis connections
// ---------------------------------------------------------------------------
//
// One connection string (`REDIS_URL`) feeds every caller, but each caller gets
// its own named client, its own circuit-breaker window and its own warning
// throttle — because the two callers want opposite failure behaviour:
//
//   "rate-limit"    fails fast (`maxRetriesPerRequest: 0`) and treats an open
//                   circuit as a hard error, so an incoming request is rejected
//                   rather than queued while Redis is down.
//   "deep-research" retries (`maxRetriesPerRequest: null`) and treats an open
//                   circuit as "no cache", falling back to MongoDB.
//
// Clients live on `globalThis` so they survive Next.js dev hot-reloads, which
// re-require modules but keep the process.

export type RedisClientName = "rate-limit" | "deep-research";

export interface RedisClientOptions {
  /** ioredis `maxRetriesPerRequest`. `0` fails fast, `null` retries indefinitely. */
  maxRetriesPerRequest?: number | null;
  /** How long the circuit stays open after a connection error. */
  disableWindowMs?: number;
  /** Minimum gap between repeated failure warnings for this client. */
  warningThrottleMs?: number;
}

export type RedisClientResolution =
  | { status: "ready"; client: Redis }
  /** No `REDIS_URL` configured — the caller decides whether that is fatal. */
  | { status: "unconfigured" }
  /** A recent failure opened the circuit; the caller decides how to degrade. */
  | { status: "circuit-open" };

interface RedisSlot {
  client?: Redis;
  disabledUntil: number;
  lastWarningAt: number;
}

const DEFAULT_DISABLE_WINDOW_MS = 30_000;
const DEFAULT_WARNING_THROTTLE_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;

declare global {
  var __geniechatRedisSlots: Map<RedisClientName, RedisSlot> | undefined;
  var __geniechatRedisShutdownRegistered: boolean | undefined;
}

function slots(): Map<RedisClientName, RedisSlot> {
  if (!globalThis.__geniechatRedisSlots) {
    globalThis.__geniechatRedisSlots = new Map();
  }
  return globalThis.__geniechatRedisSlots;
}

function slotFor(name: RedisClientName): RedisSlot {
  const existing = slots().get(name);
  if (existing) return existing;

  const created: RedisSlot = { disabledUntil: 0, lastWarningAt: 0 };
  slots().set(name, created);
  return created;
}

/**
 * Close and forget one client. Safe to call when the slot is already empty.
 *
 * `disconnect(false)` means "do not reconnect" — without it ioredis would open
 * a fresh connection immediately, which is the opposite of what a circuit
 * breaker wants.
 */
export function disposeRedisClient(name: RedisClientName): void {
  const slot = slotFor(name);
  const client = slot.client;
  slot.client = undefined;
  if (!client) return;

  try {
    client.disconnect(false);
  } catch {
    // best-effort: the socket may already be gone
  }
}

/**
 * Close every Redis connection on process exit. Registered lazily on first
 * connection, because Next.js dev hot-reload fires `beforeExit` before
 * re-requiring the module and production fires `SIGTERM` on deploy.
 */
function ensureShutdownHandler(): void {
  if (globalThis.__geniechatRedisShutdownRegistered) return;
  globalThis.__geniechatRedisShutdownRegistered = true;

  const shutdown = () => {
    for (const [name, slot] of slots()) {
      if (!slot.client) continue;
      logger.info({ name }, "[Redis] Closing client on shutdown");
      disposeRedisClient(name);
    }
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("beforeExit", shutdown);
}

/**
 * Trip the circuit breaker for one client: open the circuit for the configured
 * window, log a throttled warning, and drop the connection so the next call
 * after the window reconnects from scratch.
 */
export function reportRedisFailure(
  name: RedisClientName,
  error: unknown,
  options: RedisClientOptions = {},
  logContext: Record<string, unknown> = {},
): void {
  const slot = slotFor(name);
  const now = Date.now();
  const disableWindowMs = options.disableWindowMs ?? DEFAULT_DISABLE_WINDOW_MS;

  slot.disabledUntil = now + disableWindowMs;

  const throttleMs = options.warningThrottleMs ?? DEFAULT_WARNING_THROTTLE_MS;
  if (now - slot.lastWarningAt >= throttleMs) {
    slot.lastWarningAt = now;
    logger.warn(
      { err: error, ...logContext },
      `[Redis:${name}] unavailable – circuit open for ${
        disableWindowMs / 1000
      }s while Redis recovers`,
    );
  }

  disposeRedisClient(name);
}

/**
 * Resolve the named client, connecting on first use.
 *
 * Returns a discriminated result rather than throwing or returning a bare
 * `null`, because "no Redis configured" and "Redis is failing" need different
 * responses at every call site.
 */
export function getRedisClient(
  name: RedisClientName,
  options: RedisClientOptions = {},
): RedisClientResolution {
  // Checked on the value itself so TypeScript narrows away the `undefined`.
  const url = config.redis.url;
  if (!url) return { status: "unconfigured" };

  const slot = slotFor(name);

  if (Date.now() < slot.disabledUntil) return { status: "circuit-open" };
  if (slot.client) return { status: "ready", client: slot.client };

  // ioredis parses the URL itself: scheme selects TLS (`rediss://`), and any
  // credentials in the userinfo become the AUTH password.
  const client = new Redis(url, {
    maxRetriesPerRequest: options.maxRetriesPerRequest ?? 0,
    family: 4,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });

  client.on("connect", () =>
    logger.info(`[Redis:${name}] connection established`),
  );
  client.on("ready", () => logger.info(`[Redis:${name}] client ready`));
  client.on("reconnecting", () => logger.warn(`[Redis:${name}] reconnecting…`));
  client.on("error", (error) => {
    reportRedisFailure(name, error, options, { phase: "connection" });
  });

  slot.client = client;
  ensureShutdownHandler();

  return { status: "ready", client };
}
