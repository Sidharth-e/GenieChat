import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/agent-api-auth";
import { AutoTaskStore } from "@/lib/mongodb/auto-task-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const taskStore = isDatabaseConfigured() ? new AutoTaskStore() : null;

const resultSchema = z.object({
    taskId: z.string().min(1).max(256),
    result: z.unknown().optional(),
    error: z.string().max(4096).optional(),
});

export async function POST(request: NextRequest) {
    try {
        const auth = await authenticateApiKey(request);
        if (!auth.authenticated || !auth.apiKey) {
            return api.unauthorized(auth.error || "Unauthorized");
        }

        const rateLimit = await checkRateLimit(request, {
            namespace: "auto_result_write",
            identifier: auth.apiKey.userId,
            ...config.rateLimit.medium,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        if (!taskStore) return api.serviceUnavailable("Database not configured");

        const parsed = resultSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
            return api.badRequest("Invalid request body");
        }

        const { taskId, result, error } = parsed.data;

        const userId = auth.apiKey.userId;

        if (error) {
            await taskStore.failTask(taskId, userId, String(error));
        } else {
            const resultStr = typeof result === "string" ? result : result != null ? JSON.stringify(result) : "(no response)";
            await taskStore.completeTask(taskId, userId, resultStr);
        }

        return api.success({ status: "ok" });
    } catch (error) {
        return handleError(error, "Submit auto result");
    }
}
