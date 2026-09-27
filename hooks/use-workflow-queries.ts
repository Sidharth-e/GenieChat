"use client";

import { useQuery } from "@tanstack/react-query";
import { WorkflowExecution } from "@/lib/types";

/**
 * Fetches workflow execution history for a specific workflow.
 * Provides automatic caching, retry logic, and background revalidation.
 */
export function useWorkflowExecutions(workflowId: string) {
    return useQuery<WorkflowExecution[]>({
        queryKey: ["workflowExecutions", workflowId],
        queryFn: async () => {
            const response = await fetch(`/api/workflows/${workflowId}/executions`);
            if (!response.ok) {
                throw new Error("Failed to fetch execution history");
            }
            return response.json();
        },
        enabled: !!workflowId,
    });
}

/**
 * Fetches a single workflow execution by ID.
 * Provides automatic caching, retry logic, and background revalidation.
 */
export function useWorkflowExecution(executionId: string | null) {
    return useQuery<WorkflowExecution>({
        queryKey: ["workflowExecution", executionId],
        queryFn: async () => {
            const response = await fetch(`/api/workflows/executions/${executionId}`);
            if (!response.ok) {
                throw new Error("Failed to fetch execution details");
            }
            return response.json();
        },
        enabled: !!executionId,
    });
}
