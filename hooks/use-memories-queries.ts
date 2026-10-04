"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MEMORY_FACT_PAGE_MAX } from "@/constants/memory";
import { capturePoll } from "@/lib/memory/capture-poll";
import type { RecalledFact } from "@/lib/memory/types";
import type { MemoryGraphView } from "@/lib/memory/graph-view";

export const memoryKeys = {
    all: ["memories"] as const,
    lists: () => [...memoryKeys.all, "list"] as const,
    graph: () => [...memoryKeys.all, "graph"] as const,
};

/**
 * One page of current facts, the true total, and how many captures are still
 * awaiting extraction.
 *
 * The endpoint paginates because the corpus is unbounded; the list is fetched
 * at the endpoint's own ceiling and filtered client-side, so the search box
 * covers everything one request can carry rather than only its first page.
 * `total` is what the reader needs to know that even that ceiling was reached.
 * `pending` is the signal the list polls on — see `useMemories`.
 */
export interface MemoryListResponse {
    facts: RecalledFact[];
    total: number;
    pending: number;
    limit: number;
    offset: number;
}

/**
 * Fetches the memory list, reading again while a capture is pending.
 *
 * `staleTime: 0` because every response is a snapshot of a graph that is
 * mid-change: a save stages a capture, and the page it returns is correct and
 * immediately out of date. Caching it would make the list's own accuracy a
 * function of when it was last read.
 *
 * The poll is keyed on the pending count rather than a fixed window, so it ends
 * because the work ended — and `capturePoll` owns that decision, including the
 * ceiling for an app whose sweep never runs. The window's start is carried in a
 * ref, which is what keeps the ceiling measuring one burst rather than resetting
 * on every read.
 */
export function useMemories() {
    const sinceRef = useRef<number | null>(null);

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
        staleTime: 0,
        refetchInterval: (query) => {
            const decision = capturePoll({
                pending: query.state.data?.pending ?? 0,
                since: sinceRef.current,
                now: Date.now(),
            });
            sinceRef.current = decision.since;
            return decision.interval;
        },
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
 *
 * `staleTime: 0` for the same reason as the list: a capture the extractor has
 * just materialized makes any cached drawing wrong. It carries no poll — the
 * graph is five round trips per read and the tab is opened deliberately, so a
 * stale-while-visible read is the trade this makes.
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
        staleTime: 0,
    });
}

/**
 * Captures a sentence and invalidates the list.
 *
 * No optimistic row: a capture is not a fact. It has no subject, predicate or
 * object until the extractor has run, so a card invented here would show the
 * reader something the graph does not hold.
 *
 * The invalidated read comes back with a fact still absent and `pending` above
 * zero, and that is what starts the list's poll — the save itself schedules no
 * second read, because how long extraction takes is not something the caller
 * knows.
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
