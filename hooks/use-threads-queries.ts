"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Thread, Message } from "@/lib/types";

interface SharedUser {
    id: string;
    displayName: string;
    email: string;
}

interface ShareResult {
    isShared: boolean;
    shareId?: string;
    shareMode?: "public" | "specific";
    sharedWith?: SharedUser[];
}

export const threadKeys = {
    all: ["threads"] as const,
    lists: () => [...threadKeys.all, "list"] as const,
    details: () => [...threadKeys.all, "detail"] as const,
    detail: (id: string) => [...threadKeys.details(), id] as const,
    messages: (id: string) => [...threadKeys.detail(id), "messages"] as const,
};

/**
 * Fetches all threads with automatic caching and background refetching.
 */
export function useThreads() {
    return useQuery<Thread[]>({
        queryKey: threadKeys.lists(),
        queryFn: async () => {
            const response = await fetch("/api/chat/threads");
            if (!response.ok) {
                throw new Error("Failed to fetch threads");
            }
            return response.json();
        },
        staleTime: 1000 * 60 * 5,
    });
}

export function useRecentThreads(limit: number, enabled: boolean = true) {
    return useQuery<Thread[]>({
        queryKey: [...threadKeys.lists(), "recent", limit],
        queryFn: async () => {
            const response = await fetch(
                `/api/chat/threads?limit=${encodeURIComponent(String(limit))}`,
            );
            if (!response.ok) {
                throw new Error("Failed to fetch recent threads");
            }
            return response.json();
        },
        enabled,
        staleTime: 1000 * 60 * 5,
    });
}

export function useThreadMessages(threadId: string | undefined) {
    return useQuery<Message[]>({
        queryKey: threadKeys.messages(threadId ?? ""),
        queryFn: async () => {
            if (!threadId) return [];
            const response = await fetch(
                `/api/chat/threads/${encodeURIComponent(threadId)}`,
            );
            if (!response.ok) {
                throw new Error("Failed to fetch thread messages");
            }
            return response.json();
        },
        enabled: Boolean(threadId && threadId !== "new" && threadId !== "pending-new-chat"),
        staleTime: 1000 * 30,
    });
}

/**
 * Deletes a thread with optimistic updates.
 */
export function useDeleteThread() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (threadId: string) => {
            const response = await fetch("/api/chat/threads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, action: "delete" }),
            });

            if (!response.ok) {
                throw new Error("Failed to delete thread");
            }

            return threadId;
        },
        onMutate: async (threadId) => {
            await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

            const previousThreads = queryClient.getQueryData<Thread[]>(threadKeys.lists());

            queryClient.setQueryData<Thread[]>(threadKeys.lists(), (old) =>
                old?.filter((thread) => thread.id !== threadId)
            );

            return { previousThreads };
        },
        onError: (_err, _threadId, context) => {
            if (context?.previousThreads) {
                queryClient.setQueryData(threadKeys.lists(), context.previousThreads);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
        },
    });
}

/**
 * Toggles bookmark status with optimistic updates.
 */
export function useToggleBookmark() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (threadId: string) => {
            const response = await fetch("/api/chat/threads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, action: "bookmark" }),
            });

            if (!response.ok) {
                throw new Error("Failed to toggle bookmark");
            }

            return threadId;
        },
        onMutate: async (threadId) => {
            await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

            const previousThreads = queryClient.getQueryData<Thread[]>(threadKeys.lists());

            queryClient.setQueryData<Thread[]>(threadKeys.lists(), (old) =>
                old?.map((thread) =>
                    thread.id === threadId
                        ? { ...thread, isBookmarked: !thread.isBookmarked }
                        : thread
                )
            );

            return { previousThreads };
        },
        onError: (_err, _threadId, context) => {
            if (context?.previousThreads) {
                queryClient.setQueryData(threadKeys.lists(), context.previousThreads);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
        },
    });
}

/**
 * Renames a thread with optimistic updates.
 */
export function useRenameThread() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ threadId, title }: { threadId: string; title: string }) => {
            const response = await fetch("/api/chat/threads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ threadId, action: "rename", data: { title } }),
            });

            if (!response.ok) {
                throw new Error("Failed to rename thread");
            }

            return { threadId, title };
        },
        onMutate: async ({ threadId, title }) => {
            await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

            const previousThreads = queryClient.getQueryData<Thread[]>(threadKeys.lists());

            queryClient.setQueryData<Thread[]>(threadKeys.lists(), (old) =>
                old?.map((thread) =>
                    thread.id === threadId ? { ...thread, title } : thread
                )
            );

            return { previousThreads };
        },
        onError: (_err, _variables, context) => {
            if (context?.previousThreads) {
                queryClient.setQueryData(threadKeys.lists(), context.previousThreads);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
        },
    });
}

/**
 * Shares a thread with cache invalidation.
 */
export function useShareThread() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            threadId,
            enable,
            shareMode,
            sharedWith,
        }: {
            threadId: string;
            enable?: boolean;
            shareMode?: "public" | "specific";
            sharedWith?: SharedUser[];
        }): Promise<ShareResult> => {
            const response = await fetch("/api/chat/threads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    threadId,
                    action: "share",
                    data: { enable, shareMode, sharedWith },
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to share thread");
            }

            return response.json();
        },
        onSuccess: (data, { threadId }) => {
            queryClient.setQueryData<Thread[]>(threadKeys.lists(), (old) =>
                old?.map((thread) =>
                    thread.id === threadId
                        ? {
                              ...thread,
                              isShared: data.isShared,
                              shareId: data.shareId,
                              shareMode: data.shareMode,
                              sharedWith: data.sharedWith,
                          }
                        : thread
                )
            );
        },
    });
}
