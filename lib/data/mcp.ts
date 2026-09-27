import { logger } from "@/lib/logger";
import { MCPServerConfig } from "@/lib/types";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";

/**
 * Server-side function to fetch MCP servers for the current user.
 * This is intended for use in Server Components.
 */
export async function getMCPServers(): Promise<MCPServerConfig[]> {
    try {
        const user = await getSessionUser();
        if (!user) return [];

        if (!isDatabaseConfigured()) return [];

        const store = new MCPStore();
        return store.getMCPServers(user.id);
    } catch (error) {
        logger.error("Error fetching MCP servers server-side:", error);
        return [];
    }
}
