import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";

export async function GET(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const limitParam = req.nextUrl.searchParams.get("limit");
        const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
        const limit =
            parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0
                ? Math.min(parsedLimit, 50)
                : undefined;

        const threads = await store.getThreads(user.id, limit);
        return api.success(threads);
    } catch (error) {
        return handleError(error, "Get threads");
    }
}

export async function POST(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const rateLimit = await checkRateLimit(req, {
            namespace: "threads_write",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const {
            model = DEFAULT_MODEL_ID,
            agentId,
            isMultiAgent,
            threadType,
        } = await req.json();
        const normalizedThreadType = threadType === "research" ? "research" : "chat";

        const thread = await store.createThread(
            user.id,
            model,
            agentId,
            isMultiAgent,
            normalizedThreadType,
            undefined,
            user.name,
            user.email,
        );
        return api.success(thread);
    } catch (error) {
        return handleError(error, "Create thread");
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const rateLimit = await checkRateLimit(req, {
            namespace: "threads_write",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const { threadId, action, data } = await req.json();

        if (!threadId) return api.badRequest("Thread ID required");

        const thread = await store.getThread(threadId);
        if (!thread) return api.notFound("Thread");

        if (thread.userId !== user.id) return api.forbidden();

        switch (action) {
            case "bookmark":
                await store.updateThread(threadId, {
                    isBookmarked: !thread.isBookmarked,
                });
                break;

            case "rename":
                if (!data?.title) return api.badRequest("Title required");
                await store.updateThread(threadId, { title: data.title });
                break;

            case "delete":
                await store.deleteThread(threadId);
                break;

            default:
                return api.badRequest("Invalid action");
        }

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Update thread");
    }
}
