import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { MemoryCategory } from "@/lib/types";

const memoryStore = new MemoryGraphStore();

export async function GET(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const { searchParams } = new URL(req.url);
        const query = searchParams.get("query")?.trim();
        const requestedLimit = Number(searchParams.get("limit"));
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
            : 10;

        if (query) {
            const result = await memoryStore.searchRelevantMemoriesWithGraph(
                user.id,
                query,
                limit,
            );
            return NextResponse.json(result);
        }

        const memories = await memoryStore.getMemories(user.id);
        return NextResponse.json(memories);
    } catch (error) {
        logger.error({ err: error }, "Error fetching memories");
        return api.serverError("Failed to fetch memories");
    }
}

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

        const { content, category } = await req.json();

        if (!content || typeof content !== "string") {
            return api.badRequest("Content is required");
        }

        const memory = await memoryStore.createMemory({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            content: content.trim(),
            category: category as MemoryCategory | undefined,
        });

        return NextResponse.json(memory, { status: 201 });
    } catch (error) {
        logger.error({ err: error }, "Error creating memory");
        return api.serverError("Failed to create memory");
    }
}
