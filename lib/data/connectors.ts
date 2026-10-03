import { logger } from "@/lib/logger";
import { ConnectorConfig } from "@/lib/types";
import { ConnectorStore } from "@/lib/mongodb/connector-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";

/**
 * Server-side function to fetch connectors for the current user.
 * This is intended for use in Server Components.
 */
export async function getConnectors(): Promise<ConnectorConfig[]> {
    try {
        const user = await getSessionUser();
        if (!user) return [];

        if (!isDatabaseConfigured()) return [];

        const store = new ConnectorStore();
        return store.getConnectors(user.id);
    } catch (error) {
        logger.error("Error fetching connectors server-side:", error);
        return [];
    }
}
