import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import type Redis from "ioredis";
import {
  getRedisClient,
  reportRedisFailure,
  type RedisClientOptions,
} from "@/lib/redis-client";
import { ApiError } from "@/lib/api-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitConfig {
  namespace: string;
  limit: number;
  windowMs: number;
  /** Override the auto-detected identifier (IP address). */
  identifier?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  storage: "redis";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Rate limiting is temporarily unavailable. Please try again shortly.";

/**
 * Rate limiting wants the opposite of patience: `maxRetriesPerRequest: 0` makes
 * ioredis fail immediately instead of queueing commands, so a request is
 * rejected outright while Redis is down rather than held open. The short
 * disable window keeps that rejection window brief.
 */
const REDIS_OPTIONS: RedisClientOptions = {
  maxRetriesPerRequest: 0,
  disableWindowMs: 30_000,
};

// Simple IP address validation (IPv4 and IPv6)
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$|^([\da-f]{0,4}:){2,7}[\da-f]{0,4}$/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

declare global {
  var __rateLimitSeqCounter: number | undefined;
}

/** Monotonically increasing counter for unique Lua member keys. */
function nextSeq(): number {
  globalThis.__rateLimitSeqCounter =
    ((globalThis.__rateLimitSeqCounter ?? 0) + 1) & 0xffffff;
  return globalThis.__rateLimitSeqCounter;
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

function getClientIp(req: NextRequest): string {
  const candidates: string[] = [];

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // X-Forwarded-For can be a comma-separated list; the leftmost is the client
    for (const part of xff.split(",")) {
      candidates.push(part.trim());
    }
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) candidates.push(realIp.trim());

  // Return the first value that looks like a real IP address
  for (const candidate of candidates) {
    if (candidate && IP_REGEX.test(candidate)) {
      return candidate;
    }
  }

  logger.warn(
    "[RateLimit] Could not determine client IP; falling back to 'unknown'",
  );
  return "unknown";
}

// ---------------------------------------------------------------------------
// Rate-limit logic
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter backed by Redis.
 *
 * The member key is `<timestamp>-<seq>` so concurrent requests in the same
 * millisecond are NOT silently collapsed by ZADD.
 */
const SLIDING_WINDOW_SCRIPT = `
  local key    = KEYS[1]
  local limit  = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local now    = tonumber(ARGV[3])
  local member = ARGV[4]

  -- Evict entries outside the current window
  redis.call("ZREMRANGEBYSCORE", key, 0, now - (window * 1000))

  local count = redis.call("ZCARD", key)

  if count < limit then
    -- Use a unique member so same-millisecond requests don't overwrite each other
    redis.call("ZADD", key, now, member)
    redis.call("PEXPIRE", key, window * 1000)
    return {1, limit - count - 1, 0}
  else
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    local retryAfter = 0
    if #oldest > 0 then
      retryAfter = math.ceil(
        (tonumber(oldest[2]) + (window * 1000) - now) / 1000
      )
    end
    return {0, 0, math.max(1, retryAfter)}
  end
`;

async function checkRedisRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult | null> {
  const resolution = getRedisClient("rate-limit", REDIS_OPTIONS);

  // No Redis configured — signal the caller to fail open.
  if (resolution.status === "unconfigured") return null;

  if (resolution.status === "circuit-open") {
    throw new ApiError(
      RATE_LIMIT_UNAVAILABLE_MESSAGE,
      503,
      "RATE_LIMIT_UNAVAILABLE",
    );
  }

  const redis: Redis = resolution.client;
  const key = `ratelimit:${config.namespace}:${identifier}`;
  const now = Date.now();
  const windowSeconds = config.windowMs / 1000;
  // Unique member: timestamp + monotonic counter (no external UUID dep needed)
  const member = `${now}-${nextSeq()}`;

  try {
    const result = (await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1, // number of KEYS
      key, // KEYS[1]
      config.limit, // ARGV[1]
      windowSeconds, // ARGV[2]
      now, // ARGV[3]
      member, // ARGV[4]
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfterSeconds: result[2],
      storage: "redis",
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;

    reportRedisFailure("rate-limit", error, REDIS_OPTIONS, {
      namespace: config.namespace,
    });

    throw new ApiError(
      RATE_LIMIT_UNAVAILABLE_MESSAGE,
      503,
      "RATE_LIMIT_UNAVAILABLE",
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkRateLimit(
  req: NextRequest,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const identifier = config.identifier ?? getClientIp(req);

  const result = await checkRedisRateLimit(identifier, config);
  if (result) return result;

  // Redis not configured — fail open so AI endpoints work without Redis
  return {
    allowed: true,
    remaining: config.limit,
    retryAfterSeconds: 0,
    storage: "redis",
  };
}
