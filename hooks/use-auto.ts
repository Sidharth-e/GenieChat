"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

export interface AutoTask {
    id: string;
    userId: string;
    task: string;
    status: "pending" | "running" | "completed" | "failed";
    result?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
}

export function useSubmitAutoTask() {
    return useMutation<AutoTask, Error, string>({
        mutationFn: async (task) => {
            const response = await fetch("/api/auto", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ task }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error ?? "Failed to submit task");
            }
            return response.json();
        },
    });
}

export function useAutoTaskStatus(taskId: string | null) {
    return useQuery<AutoTask>({
        queryKey: ["auto-task", taskId],
        queryFn: async () => {
            const response = await fetch(`/api/auto?taskId=${taskId}`);
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error ?? "Failed to fetch task");
            }
            return response.json();
        },
        enabled: !!taskId,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (status === "completed" || status === "failed") return false;
            return 2000;
        },
    });
}
