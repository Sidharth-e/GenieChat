import { NextRequest } from "next/server";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!workflowStore) return api.serviceUnavailable("Database not configured");

        const { id } = await params;
        const execution = await workflowStore.getExecution(id);

        if (!execution) return api.notFound("Execution");
        if (execution.userId !== user.id) return api.forbidden();

        return api.success(execution);
    } catch (error) {
        return handleError(error, "Fetch execution");
    }
}
