import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { AutoTaskStore } from "@/lib/mongodb/auto-task-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const taskStore = isDatabaseConfigured() ? new AutoTaskStore() : null;

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!taskStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "auto_write",
            identifier: user.id,
            ...config.rateLimit.medium,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const { task } = await request.json();
        if (!task || typeof task !== "string" || !task.trim()) {
            return api.badRequest("Task is required");
        }

        const autoTask = await taskStore.createTask(user.id, task.trim());
        return api.created(autoTask);
    } catch (error) {
        return handleError(error, "Create auto task");
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!taskStore) return api.serviceUnavailable("Database not configured");

        const taskId = request.nextUrl.searchParams.get("taskId");
        if (!taskId) return api.badRequest("taskId is required");

        const task = await taskStore.getTask(taskId, user.id);
        if (!task) return api.notFound("Task");

        return api.success(task);
    } catch (error) {
        return handleError(error, "Get auto task");
    }
}
