"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ToolSecret } from "@/lib/types";

export const secretKeys = {
    all: ["secrets"] as const,
    lists: () => [...secretKeys.all, "list"] as const,
};

/**
 * Fetches all secrets with automatic caching.
 */
export function useSecrets(enabled = true) {
    return useQuery<ToolSecret[]>({
        queryKey: secretKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/secrets");
            if (!response.ok) {
                throw new Error("Failed to fetch secrets");
            }
            return response.json();
        },
        enabled,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

/**
 * Creates a new secret.
 */
export function useCreateSecret() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (secretData: {
            name: string;
            value: string;
            description?: string;
        }) => {
            const response = await fetch("/api/secrets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(secretData),
            });

            if (!response.ok) {
                throw new Error("Failed to create secret");
            }

            return response.json() as Promise<ToolSecret>;
        },
        onSuccess: (newSecret) => {
            queryClient.setQueryData<ToolSecret[]>(secretKeys.lists(), (old) =>
                old ? [newSecret, ...old] : [newSecret]
            );
        },
    });
}

/**
 * Deletes a secret.
 */
export function useDeleteSecret() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/secrets/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete secret");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<ToolSecret[]>(secretKeys.lists(), (old) =>
                old?.filter((secret) => secret.id !== deletedId)
            );
        },
    });
}
