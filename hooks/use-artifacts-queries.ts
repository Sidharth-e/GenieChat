"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getArtifacts,
  getArtifact,
  deleteArtifact,
} from "@/lib/artifacts/client";
import { ArtifactSummary, ArtifactDetail } from "@/lib/artifacts/types";

export const artifactKeys = {
  all: ["artifacts"] as const,
  lists: () => [...artifactKeys.all, "list"] as const,
  list: (search: string, type: string) =>
    [...artifactKeys.lists(), { search, type }] as const,
  details: () => [...artifactKeys.all, "detail"] as const,
  detail: (id: string) => [...artifactKeys.details(), id] as const,
};

export function useArtifacts(search?: string, type?: string) {
  return useQuery<ArtifactSummary[]>({
    queryKey: artifactKeys.list(search || "", type || ""),
    queryFn: () => getArtifacts(search, type),
    staleTime: 1000 * 60,
  });
}

export function useArtifact(id: string | null) {
  return useQuery<ArtifactDetail>({
    queryKey: artifactKeys.detail(id!),
    queryFn: () => getArtifact(id!),
    enabled: !!id,
  });
}

export function useDeleteArtifact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteArtifact(id).then(() => id),
    onSuccess: (deletedId) => {
      queryClient.setQueryData<ArtifactSummary[]>(
        artifactKeys.list("", ""),
        (old) => old?.filter((a) => a.id !== deletedId),
      );
      queryClient.invalidateQueries({ queryKey: artifactKeys.lists() });
    },
  });
}
