import { NextRequest } from "next/server";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getToolsForServer } from "@/lib/langchain/langchain-mcp";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";

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
        if (!server.enabled) return api.badRequest("MCP server is not enabled");

        const secretStore = new SecretStore();
        const userSecrets = await secretStore.getSecrets(user.id);
        const secretMap = userSecrets.reduce(
            (acc, secret) => {
                acc[secret.name] = secret.value;
                return acc;
            },
            {} as Record<string, string>,
        );

        const [resolvedServer] = resolveMCPServerSecrets([server], secretMap);

        const tools = await getToolsForServer(resolvedServer);
        return api.success(tools);
    } catch (error) {
        return handleError(error, "Fetch MCP tools");
    }
}
