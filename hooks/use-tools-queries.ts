"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomTool, CustomToolParameter } from "@/lib/types";

export const toolKeys = {
    all: ["tools"] as const,
    lists: () => [...toolKeys.all, "list"] as const,
    list: (filters: string) => [...toolKeys.lists(), { filters }] as const,
    details: () => [...toolKeys.all, "detail"] as const,
    detail: (id: string) => [...toolKeys.details(), id] as const,
};

/**
 * Fetches all tools with automatic caching and background refetching.
 */
export function useTools(initialData?: CustomTool[]) {
    return useQuery<CustomTool[]>({
        queryKey: toolKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/tools");
            if (!response.ok) {
                throw new Error("Failed to fetch tools");
            }
            return response.json();
        },
        initialData,
        staleTime: 1000 * 60 * 10,
    });
}

/**
 * Fetches a single tool by ID.
 */
export function useTool(id: string | null) {
    return useQuery<CustomTool>({
        queryKey: toolKeys.detail(id!),
        queryFn: async () => {
            const response = await fetch(`/api/tools/${id}`);
            if (!response.ok) {
                throw new Error("Failed to fetch tool");
            }
            return response.json();
        },
        enabled: !!id,
    });
}

/**
 * Creates a new tool with automatic cache invalidation.
 */
export function useCreateTool() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (toolData: {
            name: string;
            description: string;
            category?: string;
            code: string;
            parameters: CustomToolParameter[];
            enabled?: boolean;
            isPublic?: boolean;
        }) => {
            const response = await fetch("/api/tools", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toolData),
            });

            if (!response.ok) {
                throw new Error("Failed to create tool");
            }

            return response.json() as Promise<CustomTool>;
        },
        onSuccess: (newTool) => {
            queryClient.setQueryData<CustomTool[]>(toolKeys.lists(), (old) =>
                old ? [newTool, ...old] : [newTool]
            );
        },
    });
}

/**
 * Updates a tool with optimistic updates.
 */
export function useUpdateTool() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<CustomTool> }) => {
            const response = await fetch(`/api/tools/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update tool");
            }

            return response.json() as Promise<CustomTool>;
        },
        onMutate: async ({ id, updates }) => {
            await queryClient.cancelQueries({ queryKey: toolKeys.lists() });

            const previousTools = queryClient.getQueryData<CustomTool[]>(toolKeys.lists());

            queryClient.setQueryData<CustomTool[]>(toolKeys.lists(), (old) =>
                old?.map((tool) => (tool.id === id ? { ...tool, ...updates } : tool))
            );

            return { previousTools };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousTools) {
                queryClient.setQueryData(toolKeys.lists(), context.previousTools);
            }
        },
        onSettled: (_data, _error, { id }) => {
            queryClient.invalidateQueries({ queryKey: toolKeys.lists() });
            queryClient.invalidateQueries({ queryKey: toolKeys.detail(id) });
        },
    });
}

/**
 * Deletes a tool with cache invalidation.
 */
export function useDeleteTool() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/tools/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete tool");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<CustomTool[]>(toolKeys.lists(), (old) =>
                old?.filter((tool) => tool.id !== deletedId)
            );
        },
    });
}

/**
 * Toggles a tool's enabled state.
 */
export function useToggleTool() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
            const response = await fetch(`/api/tools/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
            });

            if (!response.ok) {
                throw new Error("Failed to toggle tool");
            }

            return response.json() as Promise<CustomTool>;
        },
        onMutate: async ({ id, enabled }) => {
            await queryClient.cancelQueries({ queryKey: toolKeys.lists() });

            const previousTools = queryClient.getQueryData<CustomTool[]>(toolKeys.lists());

            queryClient.setQueryData<CustomTool[]>(toolKeys.lists(), (old) =>
                old?.map((tool) => (tool.id === id ? { ...tool, enabled } : tool))
            );

            return { previousTools };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousTools) {
                queryClient.setQueryData(toolKeys.lists(), context.previousTools);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: toolKeys.lists() });
        },
    });
}
