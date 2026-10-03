import "server-only";
import crypto from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { api } from "@/lib/api-utils";
import { env } from "@/lib/env";

/**
 * The `CRON_SECRET` bearer check, shared by the two routes an external driver
 * calls: the tick, and the single-run dispatch seam.
 *
 * Returns the response to send when the request is not authorised, or `null` when
 * it may proceed, so a route reads:
 *
 *     const denied = checkCronSecret(request);
 *     if (denied) return denied;
 *
 * The length comparison is separate from `timingSafeEqual` because that call
 * *throws* on inputs of different lengths rather than returning false. Comparing
 * inline would turn a wrong-length token from a 401 into a 500 -- and would put
 * the throw on the path an unauthenticated caller controls.
 */
export function checkCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) return api.unauthorized("Cron secret not configured");

  const token =
    request.headers.get("authorization")?.replace("Bearer ", "") ?? "";

  // Length first, because `timingSafeEqual` throws on a length mismatch rather
  // than returning false — and the constant-time compare is what keeps the
  // secret from being recovered a byte at a time.
  const secretsMatch =
    token.length === cronSecret.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret));
  if (!secretsMatch) return api.unauthorized("Invalid cron secret");

  return null;
}
