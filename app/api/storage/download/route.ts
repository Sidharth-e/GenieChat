import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { presignGet } from "@/lib/storage";
import { isUserScopedKey, parseRef } from "@/lib/storage/ref";
import { STORAGE_TTL } from "@/constants/storage";
import { api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(req, {
      namespace: "file_download",
      identifier: user.id,
      ...config.rateLimit.download,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { searchParams } = new URL(req.url);
    const ref = searchParams.get("ref");

    if (!ref) return api.badRequest("Missing ref parameter");

    // `parseRef` rejects any bucket outside the closed set in
    // constants/storage.ts, so there is no allowlist to maintain here.
    const parsed = parseRef(ref);
    if (!parsed) return api.badRequest("Invalid storage reference");

    if (!isUserScopedKey(parsed.key, user.id)) {
      logger.error(
        `[Download] Access denied: User ${user.id} attempted ${parsed.bucket}/${parsed.key}`,
      );
      return api.forbidden();
    }

    // A redirect rather than a stream: the browser fetches the object from
    // Garage directly, so the bytes never pass through the app.
    return NextResponse.redirect(await presignGet(ref, STORAGE_TTL.download));
  } catch (error) {
    logger.error({ err: error }, "[Download] Failed to sign download URL");
    return api.serverError("Internal Server Error");
  }
}
