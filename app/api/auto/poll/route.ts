import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/agent-api-auth";
import { AutoTaskStore } from "@/lib/mongodb/auto-task-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";

const taskStore = isDatabaseConfigured() ? new AutoTaskStore() : null;

export async function GET(request: NextRequest) {
    try {
        const auth = await authenticateApiKey(request);
        if (!auth.authenticated || !auth.apiKey) {
            return api.unauthorized(auth.error || "Unauthorized");
        }

        if (!taskStore) return api.serviceUnavailable("Database not configured");

        const userId = auth.apiKey.userId;
        const task = await taskStore.getPendingTask(userId);

        if (!task) {
            return new NextResponse(null, { status: 204 });
        }

        const claimed = await taskStore.claimTask(task.id, userId);
        if (!claimed) {
            return new NextResponse(null, { status: 204 });
        }

        return api.success({ id: task.id, task: task.task });
    } catch (error) {
        return handleError(error, "Poll auto task");
    }
}
