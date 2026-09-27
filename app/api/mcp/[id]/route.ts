import { NextRequest } from "next/server";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!mcpStore) return api.serviceUnavailable("Database not configured");

        const { id } = await params;
        const server = await mcpStore.getMCPServer(id);

        if (!server) return api.notFound("MCP server");
        if (server.userId !== user.id) return api.forbidden();

        return api.success(server);
    } catch (error) {
        return handleError(error, "Fetch MCP server");
    }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!mcpStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "mcp_write",
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
        const existingServer = await mcpStore.getMCPServer(id);

        if (!existingServer) return api.notFound("MCP server");
        if (existingServer.userId !== user.id) return api.forbidden();

        const body = await request.json();
        if (body.transportType && body.transportType !== "http" && body.transportType !== "sse") {
            return api.badRequest("Only HTTP and SSE transports are supported");
        }

        const updatedServer = await mcpStore.updateMCPServer(id, body);

        if (!updatedServer) return api.serverError("Failed to update MCP server");

        return api.success(updatedServer);
    } catch (error) {
        return handleError(error, "Update MCP server");
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!mcpStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "mcp_write",
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
        const existingServer = await mcpStore.getMCPServer(id);

        if (!existingServer) return api.notFound("MCP server");
        if (existingServer.userId !== user.id) return api.forbidden();

        const deleted = await mcpStore.deleteMCPServer(id);
        if (!deleted) return api.serverError("Failed to delete MCP server");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete MCP server");
    }
}
