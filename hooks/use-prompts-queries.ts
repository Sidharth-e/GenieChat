"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Prompt } from "@/lib/types";

export const promptKeys = {
  all: ["prompts"] as const,
  lists: () => [...promptKeys.all, "list"] as const,
  list: (filters: string) => [...promptKeys.lists(), { filters }] as const,
  details: () => [...promptKeys.all, "detail"] as const,
  detail: (id: string) => [...promptKeys.details(), id] as const,
};

/**
 * Fetches all prompts with automatic caching and background refetching.
 */
export function usePrompts(initialData?: Prompt[]) {
  return useQuery<Prompt[]>({
    queryKey: promptKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/prompts");
      if (!response.ok) {
        throw new Error("Failed to fetch prompts");
      }
      return response.json();
    },
    initialData,
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Fetches a single prompt by ID.
 */
export function usePrompt(id: string | null) {
  return useQuery<Prompt>({
    queryKey: promptKeys.detail(id!),
    queryFn: async () => {
      const response = await fetch(`/api/prompts/${id}`);
      if (!response.ok) {
        throw new Error("Failed to fetch prompt");
      }
      return response.json();
    },
    enabled: !!id,
  });
}

/**
 * Creates a new prompt with automatic cache invalidation.
 */
export function useCreatePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (promptData: {
      title: string;
      content: string;
      tags?: string[];
      isShared?: boolean;
    }) => {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promptData),
      });

      if (!response.ok) {
        throw new Error("Failed to create prompt");
      }

      return response.json() as Promise<Prompt>;
    },
    onSuccess: (newPrompt) => {
      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old ? [newPrompt, ...old] : [newPrompt],
      );
    },
  });
}

/**
 * Updates a prompt with optimistic updates.
 */
export function useUpdatePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Prompt>;
    }) => {
      const response = await fetch(`/api/prompts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error("Failed to update prompt");
      }

      return response.json() as Promise<Prompt>;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() });

      const previousPrompts = queryClient.getQueryData<Prompt[]>(
        promptKeys.lists(),
      );

      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old?.map((prompt) =>
          prompt.id === id ? { ...prompt, ...updates } : prompt,
        ),
      );

      return { previousPrompts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousPrompts) {
        queryClient.setQueryData(promptKeys.lists(), context.previousPrompts);
      }
    },
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() });
      queryClient.invalidateQueries({ queryKey: promptKeys.detail(id) });
    },
  });
}

/**
 * Deletes a prompt with cache invalidation.
 */
export function useDeletePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/prompts/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete prompt");
      }

      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old?.filter((prompt) => prompt.id !== deletedId),
      );
    },
  });
}

/**
 * Shares or unshares a prompt.
 */
export function useSharePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      promptId,
      enable,
      shareMode,
      sharedWith,
    }: {
      promptId: string;
      enable: boolean;
      shareMode?: "public" | "specific";
      sharedWith?: { id: string; displayName: string; email: string }[];
    }) => {
      const response = await fetch(`/api/prompts/${promptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: enable ? "share" : "unshare",
          shareMode,
          sharedWith,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update sharing status");
      }

      return response.json() as Promise<Prompt>;
    },
    onSuccess: (updatedPrompt) => {
      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old?.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p)),
      );
      queryClient.invalidateQueries({
        queryKey: promptKeys.detail(updatedPrompt.id),
      });
    },
  });
}

/**
 * Favorites or unfavorites a prompt for the current user.
 */
export function useToggleFavoritePrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      promptId,
      favorite,
    }: {
      promptId: string;
      favorite: boolean;
    }) => {
      const response = await fetch(`/api/prompts/${promptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: favorite ? "favorite" : "unfavorite",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update favorite");
      }

      return response.json() as Promise<Prompt>;
    },
    onMutate: async ({ promptId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() });
      await queryClient.cancelQueries({ queryKey: promptKeys.detail(promptId) });

      const previousPrompts = queryClient.getQueryData<Prompt[]>(
        promptKeys.lists(),
      );
      const previousPrompt = queryClient.getQueryData<Prompt>(
        promptKeys.detail(promptId),
      );

      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old?.map((prompt) =>
          prompt.id === promptId ? { ...prompt, isFavorite: favorite } : prompt,
        ),
      );

      queryClient.setQueryData<Prompt>(promptKeys.detail(promptId), (old) =>
        old ? { ...old, isFavorite: favorite } : old,
      );

      return { previousPrompts, previousPrompt };
    },
    onError: (_error, variables, context) => {
      if (context?.previousPrompts) {
        queryClient.setQueryData(promptKeys.lists(), context.previousPrompts);
      }
      if (context?.previousPrompt) {
        queryClient.setQueryData(
          promptKeys.detail(variables.promptId),
          context.previousPrompt,
        );
      }
    },
    onSuccess: (updatedPrompt) => {
      queryClient.setQueryData<Prompt[]>(promptKeys.lists(), (old) =>
        old?.map((prompt) =>
          prompt.id === updatedPrompt.id ? updatedPrompt : prompt,
        ),
      );
      queryClient.setQueryData<Prompt>(
        promptKeys.detail(updatedPrompt.id),
        updatedPrompt,
      );
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: promptKeys.detail(variables.promptId),
      });
    },
  });
}
