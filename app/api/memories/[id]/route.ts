import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const memoryStore = new MemoryGraphStore();

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const { id } = await params;
        const fact = await memoryStore.getFact(user.id, id);
        if (!fact) return api.notFound("Memory");

        return NextResponse.json(fact);
    } catch (error) {
        return handleError(error, "get memory");
    }
}

/**
 * There is no `PUT`, and adding one would be a mistake.
 *
 * A fact is derived from a captured sentence, so there is nothing here to edit.
 * A correction is a new sentence — "actually I work as Rust now" — and the
 * supersede rule closes the fact it replaces.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const deleted = await memoryStore.deleteFact(user.id, id);
        if (!deleted) return api.notFound("Memory");

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handleError(error, "delete memory");
    }
}
