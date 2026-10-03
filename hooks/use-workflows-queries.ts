"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RichWorkflow, WorkflowTrigger } from "@/lib/types";

export const workflowKeys = {
    all: ["workflows"] as const,
    lists: () => [...workflowKeys.all, "list"] as const,
    list: (filters: string) => [...workflowKeys.lists(), { filters }] as const,
    details: () => [...workflowKeys.all, "detail"] as const,
    detail: (id: string) => [...workflowKeys.details(), id] as const,
    executions: (workflowId: string) => [...workflowKeys.all, "executions", workflowId] as const,
    execution: (executionId: string) => [...workflowKeys.all, "execution", executionId] as const,
};

/**
 * Fetches all workflows with automatic caching and background refetching.
 */
export function useWorkflows() {
    return useQuery<RichWorkflow[]>({
        queryKey: workflowKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/workflows");
            if (!response.ok) {
                throw new Error("Failed to fetch workflows");
            }
            return response.json();
        },
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Fetches a single workflow by ID.
 */
export function useWorkflow(id: string | null) {
    return useQuery<RichWorkflow>({
        queryKey: workflowKeys.detail(id!),
        queryFn: async () => {
            const response = await fetch(`/api/workflows/${id}`);
            if (!response.ok) {
                throw new Error("Failed to fetch workflow");
            }
            return response.json();
        },
        enabled: !!id,
    });
}

/**
 * Creates a new workflow with automatic cache invalidation.
 */
export function useCreateWorkflow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (workflowData: {
            name: string;
            description?: string;
            trigger?: WorkflowTrigger;
        }) => {
            const response = await fetch("/api/workflows/node", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(workflowData),
            });

            if (!response.ok) {
                throw new Error("Failed to create workflow");
            }

            return response.json() as Promise<RichWorkflow>;
        },
        onSuccess: (newWorkflow) => {
            queryClient.setQueryData<RichWorkflow[]>(workflowKeys.lists(), (old) =>
                old ? [newWorkflow, ...old] : [newWorkflow]
            );
        },
    });
}

/**
 * Updates a workflow with optimistic updates.
 */
export function useUpdateWorkflow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            id,
            updates,
        }: {
            id: string;
            updates: Partial<Omit<RichWorkflow, "id" | "userId" | "createdAt">>;
        }) => {
            const response = await fetch(`/api/workflows/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!response.ok) {
                throw new Error("Failed to update workflow");
            }

            return response.json() as Promise<RichWorkflow>;
        },
        onMutate: async ({ id, updates }) => {
            await queryClient.cancelQueries({ queryKey: workflowKeys.lists() });

            const previousWorkflows = queryClient.getQueryData<RichWorkflow[]>(workflowKeys.lists());

            queryClient.setQueryData<RichWorkflow[]>(workflowKeys.lists(), (old) =>
                old?.map((workflow) =>
                    workflow.id === id ? { ...workflow, ...updates } : workflow
                )
            );

            return { previousWorkflows };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousWorkflows) {
                queryClient.setQueryData(workflowKeys.lists(), context.previousWorkflows);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
        },
    });
}

/**
 * Deletes a workflow with cache invalidation.
 */
export function useDeleteWorkflow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetch(`/api/workflows/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                throw new Error("Failed to delete workflow");
            }

            return id;
        },
        onSuccess: (deletedId) => {
            queryClient.setQueryData<RichWorkflow[]>(workflowKeys.lists(), (old) =>
                old?.filter((workflow) => workflow.id !== deletedId)
            );
        },
    });
}
