import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { getObjectAsBuffer } from "@/lib/storage";
import { isUserScopedKey, parseRef } from "@/lib/storage/ref";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { config } from "@/lib/config";

export async function GET(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const rateLimit = await checkRateLimit(req, {
            namespace: "report_download",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return new NextResponse(
                JSON.stringify({ error: `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s` }),
                { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
            );
        }

        const { searchParams } = new URL(req.url);
        const ref = searchParams.get("ref");

        if (!ref) {
            return new NextResponse("Missing report reference", { status: 400 });
        }

        // Read server-side by reference. Two things this buys over the previous
        // `fetch(reportUrl)`: the object is fetched from Garage rather than an
        // arbitrary client-supplied address, and ownership is actually checked.
        const parsed = parseRef(ref);
        if (!parsed || parsed.bucket !== STORAGE_BUCKETS.reports) {
            return new NextResponse("Invalid report reference", { status: 400 });
        }
        if (!isUserScopedKey(parsed.key, user.id)) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        const result = await getObjectAsBuffer(ref);
        if (result.status !== "OK") {
            // Every non-OK status, not just the ones that reach the client with
            // a distinguishing code: `NOT_FOUND` — a missing object or a missing
            // bucket, since this is the read path and `isNotFoundError` covers
            // both — and the unconfigured store both return here, and both are
            // otherwise untraceable.
            logger.error(
                { err: result.errors },
                "[Report] Failed to read report object",
            );
            return new NextResponse("Failed to fetch report", {
                status: result.status === "NOT_FOUND" ? 404 : 500,
            });
        }

        return new NextResponse(result.response.toString("utf-8"), {
            headers: {
                "Content-Type": "text/markdown; charset=utf-8",
            },
        });
    } catch (error) {
        logger.error({ err: error }, "Error fetching report");
        return new NextResponse("Failed to fetch report", { status: 500 });
    }
}
