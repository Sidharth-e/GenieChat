import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { nudgeMemorySweep } from "@/lib/memory/nudge";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { boundedInt } from "@/lib/api/query-params";
import { MEMORY_FACT_PAGE_MAX, MEMORY_FACT_PAGE_SIZE } from "@/constants/memory";

const memoryStore = new MemoryGraphStore();

/**
 * The memory list: one page of current facts, newest first.
 *
 * `boundedInt` takes a `min` on purpose. `Number(null)` is `0`, `0` is finite
 * and not negative, so a guard that only rejected `NaN` let an *absent* `?limit`
 * through as zero and the default listing answered with a single row. The floor
 * is 1.
 */
export async function GET(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const { searchParams } = new URL(req.url);
        const limit = boundedInt(searchParams.get("limit"), {
            fallback: MEMORY_FACT_PAGE_SIZE,
            min: 1,
            max: MEMORY_FACT_PAGE_MAX,
        });
        const offset = boundedInt(searchParams.get("offset"), {
            fallback: 0,
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
        });

        const { facts, total, pending } = await memoryStore.listFacts(
            user.id,
            limit,
            offset,
        );

        return NextResponse.json({ facts, total, pending, limit, offset });
    } catch (error) {
        return handleError(error, "list memories");
    }
}

/**
 * Capture a sentence. The route stages; it does not extract.
 *
 * It calls the same store method the `save_memory` tool calls, so the tool and
 * the form are one write path and one idea of what a memory is. Rate limited
 * for the same reason every other write here is: each capture costs an
 * embedding call and stages work for the sweep.
 */
export async function POST(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const rateLimit = await checkRateLimit(req, {
            namespace: "memories_write",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const body = await req.json().catch(() => null);
        const text = typeof body?.content === "string" ? body.content.trim() : "";
        if (text === "") {
            return api.badRequest("Content is required");
        }

        const capture = await memoryStore.captureSentence({
            userId: user.id,
            userName: user.name ?? "",
            userEmail: user.email ?? "",
            text,
        });

        // The capture is on disk; this turns it into facts without waiting for
        // the external driver. Scheduled post-response, so the 201 is not delayed.
        nudgeMemorySweep(user.id);

        return NextResponse.json(
            { id: capture.id, text, status: "captured" },
            { status: 201 },
        );
    } catch (error) {
        return handleError(error, "save memory");
    }
}
