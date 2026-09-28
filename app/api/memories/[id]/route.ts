import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { MemoryCategory } from "@/lib/types";

const memoryStore = new MemoryGraphStore();

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const { id } = await params;
        const memory = await memoryStore.getMemory(id, user.id);

        if (!memory) {
            return api.notFound("Memory not found");
        }

        if (memory.userId !== user.id) {
            return api.forbidden("Access denied");
        }

        return NextResponse.json(memory);
    } catch (error) {
        logger.error({ err: error }, "Error fetching memory");
        return api.serverError("Failed to fetch memory");
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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
        const memory = await memoryStore.getMemory(id, user.id);

        if (!memory) {
            return api.notFound("Memory not found");
        }

        if (memory.userId !== user.id) {
            return api.forbidden("Access denied");
        }

        const { content, category } = await req.json();

        const updated = await memoryStore.updateMemory(id, user.id, {
            content: content?.trim(),
            category: category as MemoryCategory | undefined,
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ err: error }, "Error updating memory");
        return api.serverError("Failed to update memory");
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
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
        const memory = await memoryStore.getMemory(id, user.id);

        if (!memory) {
            return api.notFound("Memory not found");
        }

        if (memory.userId !== user.id) {
            return api.forbidden("Access denied");
        }

        await memoryStore.deleteMemory(id, user.id);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error({ err: error }, "Error deleting memory");
        return api.serverError("Failed to delete memory");
    }
}
