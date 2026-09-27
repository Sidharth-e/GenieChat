import { logger } from "@/lib/logger";
import { Agent } from "@/lib/types";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";

/**
 * Server-side function to fetch agents for the current user.
 * This is intended for use in Server Components.
 */
export type GetAgentsResult = 
    | { success: true; data: Agent[] }
    | { success: false; error: string; data: [] };

export async function getAgents(): Promise<GetAgentsResult> {
    try {
        const user = await getSessionUser();
        if (!user) return { success: false, error: "Unauthorized", data: [] };

        if (!isDatabaseConfigured()) return { success: false, error: "Database not configured", data: [] };

        const store = new AgentStore();
        const agents = await store.getAgents(user.id);
        return { success: true, data: agents };
    } catch (error) {
        logger.error("Error fetching agents server-side:", error);
        return { success: false, error: "Failed to fetch agents", data: [] };
    }
}
