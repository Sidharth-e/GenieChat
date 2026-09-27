import { logger } from "@/lib/logger";
import { Prompt } from "@/lib/types";
import { PromptStore } from "@/lib/mongodb/prompt-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";

/**
 * Server-side function to fetch prompts for the current user.
 * This is intended for use in Server Components.
 */
export async function getPrompts(): Promise<Prompt[]> {
    try {
        const user = await getSessionUser();
        if (!user) return [];

        if (!isDatabaseConfigured()) return [];

        const store = new PromptStore();
        return store.getPrompts(user.id);
    } catch (error) {
        logger.error("Error fetching prompts server-side:", error);
        return [];
    }
}