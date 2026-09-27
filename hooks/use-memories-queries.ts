"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Memory, MemoryCategory } from "@/lib/types";

export const memoryKeys = {
    all: ["memories"] as const,
    lists: () => [...memoryKeys.all, "list"] as const,
    list: (filters: string) => [...memoryKeys.lists(), { filters }] as const,
    details: () => [...memoryKeys.all, "detail"] as const,
    detail: (id: string) => [...memoryKeys.details(), id] as const,
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
 * Creates a new memory with automatic cache invalidation.
 */
export function useCreateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (memoryData: {
            content: string;
            category?: MemoryCategory;
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
        },
    });
}
