"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Agent, AgentDocument, AgentSkill } from "@/lib/types";
import { REVALIDATE_ALL_CACHE_META_KEY } from "@/lib/query/cache-revalidation";

export const agentKeys = {
    all: ["agents"] as const,
    lists: () => [...agentKeys.all, "list"] as const,
    list: (filters: string) => [...agentKeys.lists(), { filters }] as const,
    details: () => [...agentKeys.all, "detail"] as const,
    detail: (id: string) => [...agentKeys.details(), id] as const,
};

/**
 * Fetches all agents with automatic caching and background refetching.
 */
export function useAgents(
    initialData?: Agent[],
    options?: { enabled?: boolean },
) {
    const hasInitialData = Array.isArray(initialData);

    return useQuery<Agent[]>({
        queryKey: agentKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/agents");
            if (!response.ok) {
                throw new Error("Failed to fetch agents");
            }
            return response.json();
        },
        enabled: options?.enabled ?? true,
        staleTime: 1000 * 60 * 10,
        initialData,
        retry: 2,
        refetchOnMount: hasInitialData ? false : true,
    });
}

/**
 * Fetches a single agent by ID.
 */
export function useAgent(id: string | null) {
    return useQuery<Agent>({
        queryKey: agentKeys.detail(id!),
        queryFn: async () => {
            const response = await fetch(`/api/agents/${id}`);
            if (!response.ok) {
                throw new Error("Failed to fetch agent");
            }
            return response.json();
        },
        enabled: !!id,
    });
}

/**
 * Creates a new agent with automatic cache invalidation.
 */
export function useCreateAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        meta: { [REVALIDATE_ALL_CACHE_META_KEY]: true },
        mutationFn: async (agentData: {
            name: string;
            description: string;
            systemPrompt?: string;
            tools?: string[];
            modelId?: string;
            temperature?: number;
            topP?: number;
            subAgents?: { id: string; name: string }[];
            skills?: AgentSkill[];
            documents?: AgentDocument[];
        }) => {
            const response = await fetch("/api/agents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(agentData),
            });

            if (!response.ok) {
                throw new Error("Failed to create agent");
            }

            return response.json() as Promise<Agent>;
        },
        onSuccess: (newAgent) => {
            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old ? [newAgent, ...old] : [newAgent]
            );
        },
    });
}

/**
 * Updates an agent with optimistic updates.
 */
export function useUpdateAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<Agent> }) => {
            const response = await fetch(`/api/agents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update agent");
            }

            return response.json() as Promise<Agent>;
        },
        onMutate: async ({ id, updates }) => {
            await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

            const previousAgents = queryClient.getQueryData<Agent[]>(agentKeys.lists());

            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old?.map((agent) => (agent.id === id ? { ...agent, ...updates } : agent))
            );

            return { previousAgents };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousAgents) {
                queryClient.setQueryData(agentKeys.lists(), context.previousAgents);
            }
        },
        onSettled: (_data, _error, { id }) => {
            queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
            queryClient.invalidateQueries({ queryKey: agentKeys.detail(id) });
        },
    });
}

/**
 * Deletes an agent with cache invalidation.
 */
export function useDeleteAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        meta: { [REVALIDATE_ALL_CACHE_META_KEY]: true },
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/agents/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete agent");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old?.filter((agent) => agent.id !== deletedId)
            );
        },
    });
}

/**
 * Toggles the favorite status of an agent.
 */
export function useToggleFavoriteAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ agentId, favorite }: { agentId: string; favorite: boolean }) => {
            const response = await fetch(`/api/agents/${agentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isFavorite: favorite }),
            });

            if (!response.ok) {
                throw new Error("Failed to toggle favorite status");
            }

            return response.json() as Promise<Agent>;
        },
        onMutate: async ({ agentId, favorite }) => {
            await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

            const previousAgents = queryClient.getQueryData<Agent[]>(agentKeys.lists());

            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old?.map((agent) =>
                    agent.id === agentId ? { ...agent, isFavorite: favorite } : agent,
                ),
            );

            return { previousAgents };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousAgents) {
                queryClient.setQueryData(agentKeys.lists(), context.previousAgents);
            }
        },
        onSettled: (_data, _error, { agentId }) => {
            queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
            queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
        },
    });
}

/**
 * Toggles the active status of an agent.
 */
export function useToggleActiveAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ agentId, active }: { agentId: string; active: boolean }) => {
            const response = await fetch(`/api/agents/${agentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active }),
            });

            if (!response.ok) {
                throw new Error("Failed to toggle active status");
            }

            return response.json() as Promise<Agent>;
        },
        onMutate: async ({ agentId, active }) => {
            await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

            const previousAgents = queryClient.getQueryData<Agent[]>(agentKeys.lists());

            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old?.map((agent) =>
                    agent.id === agentId ? { ...agent, active } : agent,
                ),
            );

            return { previousAgents };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousAgents) {
                queryClient.setQueryData(agentKeys.lists(), context.previousAgents);
            }
        },
        onSettled: (_data, _error, { agentId }) => {
            queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
            queryClient.invalidateQueries({ queryKey: agentKeys.detail(agentId) });
        },
    });
}

/**
 * Activates an agent.
 */
export function useActivateAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/agents/${id}`, {
                method: "POST",
            });

            if (!response.ok) {
                throw new Error("Failed to activate agent");
            }

            return id;
        },
        onMutate: async (id) => {
            await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

            const previousAgents = queryClient.getQueryData<Agent[]>(agentKeys.lists());

            queryClient.setQueryData<Agent[]>(agentKeys.lists(), (old) =>
                old?.map((agent) => ({
                    ...agent,
                    active: agent.id === id,
                }))
            );

            return { previousAgents };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousAgents) {
                queryClient.setQueryData(agentKeys.lists(), context.previousAgents);
            }
        },
        onSettled: (_data, _error, id) => {
            queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
            queryClient.invalidateQueries({ queryKey: agentKeys.detail(id) });
        },
    });
}
