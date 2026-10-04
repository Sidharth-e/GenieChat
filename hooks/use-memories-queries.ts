"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    MEMORY_CAPTURE_SETTLE_MS,
    MEMORY_FACT_PAGE_MAX,
} from "@/constants/memory";
import type { RecalledFact } from "@/lib/memory/types";
import type { MemoryGraphView } from "@/lib/memory/graph-view";

export const memoryKeys = {
    all: ["memories"] as const,
    lists: () => [...memoryKeys.all, "list"] as const,
    graph: () => [...memoryKeys.all, "graph"] as const,
};

/**
 * One page of current facts, plus the true total.
 *
 * The endpoint paginates because the corpus is unbounded; the list is fetched
 * at the endpoint's own ceiling and filtered client-side, so the search box
 * covers everything one request can carry rather than only its first page.
 * `total` is what the reader needs to know that even that ceiling was reached.
 */
export interface MemoryListResponse {
    facts: RecalledFact[];
    total: number;
    limit: number;
    offset: number;
}

/**
 * Fetches the memory list with automatic caching and background refetching.
 */
export function useMemories() {
    return useQuery<MemoryListResponse>({
        queryKey: memoryKeys.lists(),
        queryFn: async () => {
            const response = await fetch(
                `/api/memories?limit=${MEMORY_FACT_PAGE_MAX}`,
            );
            if (!response.ok) {
                throw new Error("Failed to fetch memories");
            }
            return response.json();
        },
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Fetches the drawn memory graph — memories plus the entities and relations
 * that connect them.
 *
 * A separate query from the list rather than something derived from it, because
 * the list has no entities on it. It is not gated on a flag: the component that
 * calls it is only mounted while the graph tab is selected, so the fetch — five
 * Neo4j round trips — does not happen while the reader is still on the list.
 */
export function useMemoryGraph() {
    return useQuery<MemoryGraphView>({
        queryKey: memoryKeys.graph(),
        queryFn: async () => {
            const response = await fetch("/api/memories/graph");
            if (!response.ok) {
                throw new Error("Failed to fetch the memory graph");
            }
            return response.json();
        },
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Captures a sentence and invalidates the list.
 *
 * No optimistic row: a capture is not a fact. It has no subject, predicate or
 * object until the extractor has run, so a card invented here would show the
 * reader something the graph does not hold.
 */
export function useCreateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (memoryData: { content: string }) => {
            const response = await fetch("/api/memories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(memoryData),
            });

            if (!response.ok) {
                throw new Error("Failed to create memory");
            }

            return response.json() as Promise<{
                id: string;
                text: string;
                status: "captured";
            }>;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
            // The graph is derived from the facts, so a new capture makes the
            // drawn version wrong until it is refetched. Marking it stale is
            // free when the graph is not mounted.
            queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
            // The fact does not exist yet — the sweep runs after the response.
            // Read once more after the extraction window.
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
                queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
            }, MEMORY_CAPTURE_SETTLE_MS);
        },
    });
}

/**
 * Deletes a fact with cache invalidation.
 *
 * A delete is a real `DETACH DELETE`, and the orphan GC may collect entities,
 * predicates and values with it — so both the page and the drawing are refetched
 * rather than patched.
 */
export function useDeleteMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/memories/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete memory");
            }

            return id;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
            queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
        },
    });
}
