import { logger } from "@/lib/logger";
import { Memory } from "@/lib/types";
import { MemoryStore } from "@/lib/mongodb/memory-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import type { GraphRAGMemorySearchResult } from "@/lib/memory/types";

/**
 * Server-side function to fetch memories for the current user.
 * This is intended for use in Server Components.
 */
export async function getMemories(): Promise<Memory[]> {
    try {
        const user = await getSessionUser();
        if (!user) return [];

        if (!isDatabaseConfigured()) return [];

        const store = new MemoryStore();
        return store.getMemories(user.id);
    } catch (error) {
        logger.error("Error fetching memories server-side:", error);
        return [];
    }
}

/**
 * Server-side Graph-RAG retrieval for the current user.
 * Useful when pages/APIs need the same memory relevance strategy as chat.
 */
export async function getRelevantMemories(
    query: string,
    top: number = 5,
): Promise<GraphRAGMemorySearchResult> {
    const emptyResult: GraphRAGMemorySearchResult = {
        memories: [],
        metadata: {
            mode: "vector",
            semanticSeedCount: 0,
            lexicalSeedCount: 0,
            graphExpandedCount: 0,
            totalCandidates: 0,
        },
    };

    try {
        const user = await getSessionUser();
        if (!user) return emptyResult;

        if (!isDatabaseConfigured()) return emptyResult;

        const memoryStore = new MemoryGraphStore();
        return memoryStore.searchRelevantMemoriesWithGraph(user.id, query, top);
    } catch (error) {
        logger.error("Error fetching relevant memories server-side:", error);
        return emptyResult;
    }
}
