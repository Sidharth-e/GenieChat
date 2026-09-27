"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiKey } from "@/lib/types";

export const apiKeyKeys = {
    all: ["apiKeys"] as const,
    lists: () => [...apiKeyKeys.all, "list"] as const,
};

// The response from POST includes the raw key
interface CreateApiKeyResponse extends Omit<ApiKey, "keyHash"> {
    key: string; // raw key, only available at creation
}

/**
 * Fetches all API keys (without keyHash).
 */
export function useApiKeys(enabled = true) {
    return useQuery<Omit<ApiKey, "keyHash">[]>({
        queryKey: apiKeyKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/agents/v1/keys");
            if (!response.ok) {
                throw new Error("Failed to fetch API keys");
            }
            return response.json();
        },
        enabled,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

/**
 * Creates a new API key.
 */
export function useCreateApiKey() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: {
            name: string;
            scopes?: string[];
            expiresAt?: string;
        }) => {
            const response = await fetch("/api/agents/v1/keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error("Failed to create API key");
            }

            return response.json() as Promise<CreateApiKeyResponse>;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
        },
    });
}

/**
 * Revokes an API key.
 */
export function useRevokeApiKey() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(
                `/api/agents/v1/keys?id=${encodeURIComponent(id)}`,
                {
                    method: "DELETE",
                }
            );

            if (!response.ok) {
                throw new Error("Failed to revoke API key");
            }

            return id;
        },
        onSuccess: (revokedId) => {
            queryClient.setQueryData<Omit<ApiKey, "keyHash">[]>(
                apiKeyKeys.lists(),
                (old) => old?.filter((key) => key.id !== revokedId)
            );
        },
    });
}
