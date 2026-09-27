import { NextRequest } from "next/server";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const toolStore = isDatabaseConfigured() ? new ToolStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!toolStore) return api.serviceUnavailable("Database not configured");

        const { id } = await params;
        const tool = await toolStore.getTool(id);

        if (!tool) return api.notFound("Tool");
        if (tool.userId !== user.id) return api.forbidden();

        return api.success(tool);
    } catch (error) {
        return handleError(error, "Fetch tool");
    }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!toolStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "tools_write",
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
        const existingTool = await toolStore.getTool(id);

        if (!existingTool) return api.notFound("Tool");
        if (existingTool.userId !== user.id) return api.forbidden();

        const body = await request.json();
        const updatedTool = await toolStore.updateTool(id, body);

        if (!updatedTool) return api.serverError("Failed to update tool");

        return api.success(updatedTool);
    } catch (error) {
        return handleError(error, "Update tool");
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!toolStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "tools_write",
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
        const existingTool = await toolStore.getTool(id);

        if (!existingTool) return api.notFound("Tool");
        if (existingTool.userId !== user.id) return api.forbidden();

        const deleted = await toolStore.deleteTool(id);
        if (!deleted) return api.serverError("Failed to delete tool");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete tool");
    }
}
