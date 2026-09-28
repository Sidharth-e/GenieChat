"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Memory } from "@/lib/types";
import type { MemoryGraphView } from "@/lib/memory/graph-view";

export const memoryKeys = {
    all: ["memories"] as const,
    lists: () => [...memoryKeys.all, "list"] as const,
    list: (filters: string) => [...memoryKeys.lists(), { filters }] as const,
    details: () => [...memoryKeys.all, "detail"] as const,
    detail: (id: string) => [...memoryKeys.details(), id] as const,
    graph: () => [...memoryKeys.all, "graph"] as const,
};

/**
 * Fetches all memories with automatic caching and background refetching.
 */
export function useMemories(initialData?: Memory[]) {
    return useQuery<Memory[]>({
        queryKey: memoryKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/memories");
            if (!response.ok) {
                throw new Error("Failed to fetch memories");
            }
            return response.json();
        },
        initialData,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Fetches a single memory by ID.
 */
export function useMemory(id: string | null) {
    return useQuery<Memory>({
        queryKey: memoryKeys.detail(id!),
        queryFn: async () => {
            const response = await fetch(`/api/memories/${id}`);
            if (!response.ok) {
                throw new Error("Failed to fetch memory");
            }
            return response.json();
        },
        enabled: !!id,
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
 * Creates a new memory with automatic cache invalidation.
 */
export function useCreateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (memoryData: {
            content: string;
        }) => {
            const response = await fetch("/api/memories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(memoryData),
            });

            if (!response.ok) {
                throw new Error("Failed to create memory");
            }

            return response.json() as Promise<Memory>;
        },
        onSuccess: (newMemory) => {
            queryClient.setQueryData<Memory[]>(memoryKeys.lists(), (old) =>
                old ? [newMemory, ...old] : [newMemory]
            );
            // The graph is derived from the memories, so a new one makes the
            // drawn version wrong until it is refetched. Marking it stale is
            // free when the graph is not mounted.
            queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
        },
    });
}

/**
 * Updates a memory with optimistic updates.
 */
export function useUpdateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<Memory> }) => {
            const response = await fetch(`/api/memories/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update memory");
            }

            return response.json() as Promise<Memory>;
        },
        onMutate: async ({ id, updates }) => {
            await queryClient.cancelQueries({ queryKey: memoryKeys.lists() });

            const previousMemories = queryClient.getQueryData<Memory[]>(memoryKeys.lists());

            queryClient.setQueryData<Memory[]>(memoryKeys.lists(), (old) =>
                old?.map((memory) => (memory.id === id ? { ...memory, ...updates } : memory))
            );

            return { previousMemories };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousMemories) {
                queryClient.setQueryData(memoryKeys.lists(), context.previousMemories);
            }
        },
        onSettled: (_data, _error, { id }) => {
            queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
            queryClient.invalidateQueries({ queryKey: memoryKeys.detail(id) });
            queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
        },
    });
}

/**
 * Deletes a memory with cache invalidation.
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
        onSuccess: (deletedId) => {
            queryClient.setQueryData<Memory[]>(memoryKeys.lists(), (old) =>
                old?.filter((memory) => memory.id !== deletedId)
            );
            queryClient.invalidateQueries({ queryKey: memoryKeys.graph() });
        },
    });
}
