import { logger } from "@/lib/logger";
import { CustomTool } from "@/lib/types";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";

/**
 * Server-side function to fetch custom tools for the current user.
 * This is intended for use in Server Components.
 */
export async function getTools(): Promise<CustomTool[]> {
    try {
        const user = await getSessionUser();
        if (!user) return [];

        if (!isDatabaseConfigured()) return [];

        const store = new ToolStore();
        return store.getTools(user.id);
    } catch (error) {
        logger.error("Error fetching tools server-side:", error);
        return [];
    }
}
