import { NextRequest } from "next/server";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const toolStore = isDatabaseConfigured() ? new ToolStore() : null;

export async function GET() {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!toolStore) return api.serviceUnavailable("Database not configured");

        const tools = await toolStore.getTools(user.id);
        return api.success(tools);
    } catch (error) {
        return handleError(error, "Fetch tools");
    }
}

export async function POST(request: NextRequest) {
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

        const body = await request.json();
        const { name, description, code, parameters, enabled } = body;

        if (!name) return api.badRequest("Name is required");
        if (!code) return api.badRequest("Code is required");

        const tool = await toolStore.createTool({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            name,
            description: description || "",
            code,
            parameters: parameters || [],
            enabled: enabled !== undefined ? enabled : true,
        });

        return api.created(tool);
    } catch (error) {
        return handleError(error, "Create tool");
    }
}
