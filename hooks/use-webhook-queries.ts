"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Webhook, WebhookInvocation } from "@/lib/types";

interface WebhookWithMeta extends Webhook {
  targetName: string;
  rawSecret?: string;
}

export const webhookKeys = {
  all: ["webhooks"] as const,
  lists: () => [...webhookKeys.all, "list"] as const,
  details: () => [...webhookKeys.all, "detail"] as const,
  detail: (id: string) => [...webhookKeys.details(), id] as const,
  invocations: (id: string) =>
    [...webhookKeys.all, "invocations", id] as const,
};

export function useWebhooks() {
  return useQuery<WebhookWithMeta[]>({
    queryKey: webhookKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/webhooks");
      if (!response.ok) throw new Error("Failed to fetch webhooks");
      return response.json();
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useWebhook(id: string | null) {
  return useQuery<WebhookWithMeta>({
    queryKey: webhookKeys.detail(id!),
    queryFn: async () => {
      const response = await fetch(`/api/webhooks/${id}`);
      if (!response.ok) throw new Error("Failed to fetch webhook");
      return response.json();
    },
    enabled: !!id,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      target: { type: "workflow" | "agent"; id: string };
      enabled?: boolean;
    }) => {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create webhook");
      return response.json() as Promise<WebhookWithMeta>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<
        Pick<Webhook, "name" | "description" | "target" | "enabled">
      >;
    }) => {
      const response = await fetch(`/api/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update webhook");
      return response.json() as Promise<WebhookWithMeta>;
    },
    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
      queryClient.invalidateQueries({ queryKey: webhookKeys.detail(id) });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete webhook");
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<WebhookWithMeta[]>(
        webhookKeys.lists(),
        (old) => old?.filter((wh) => wh.id !== deletedId),
      );
    },
  });
}

export function useRotateWebhookSecret() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/webhooks/${id}/rotate`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to rotate secret");
      return response.json() as Promise<{ rawSecret: string }>;
    },
  });
}

export function useWebhookInvocations(
  webhookId: string | null,
  options?: { limit?: number; offset?: number },
) {
  return useQuery<WebhookInvocation[]>({
    queryKey: [...webhookKeys.invocations(webhookId!), options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.offset) params.set("offset", String(options.offset));
      const response = await fetch(
        `/api/webhooks/${webhookId}/invocations?${params}`,
      );
      if (!response.ok) throw new Error("Failed to fetch invocations");
      return response.json();
    },
    enabled: !!webhookId,
    refetchInterval: 10000,
  });
}
