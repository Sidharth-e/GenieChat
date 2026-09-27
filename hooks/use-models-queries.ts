"use client";

import { useQuery } from "@tanstack/react-query";
import { ModelConfig } from "@/lib/types";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

export const modelKeys = {
  all: ["models"] as const,
  lists: () => [...modelKeys.all, "list"] as const,
};

export function useModels(initialData?: ModelConfig[]) {
  return useQuery<ModelConfig[]>({
    queryKey: modelKeys.lists(),
    queryFn: async () => {
      const response = await fetch("/api/models");
      if (!response.ok) {
        throw new Error("Failed to fetch models");
      }
      return response.json();
    },
    initialData: initialData ?? AVAILABLE_MODELS,
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });
}
