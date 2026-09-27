"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getWorkspaceNotes,
  getWorkspaceNote,
  createWorkspaceNote,
  updateWorkspaceNote,
  deleteWorkspaceNote,
} from "@/lib/notes/client";
import {
  CreateWorkspaceNoteInput,
  UpdateWorkspaceNoteInput,
  WorkspaceNoteDetail,
  WorkspaceNoteSummary,
} from "@/lib/notes/types";

export const noteKeys = {
  all: ["notes"] as const,
  lists: () => [...noteKeys.all, "list"] as const,
  list: (search: string) => [...noteKeys.lists(), { search }] as const,
  details: () => [...noteKeys.all, "detail"] as const,
  detail: (id: string) => [...noteKeys.details(), id] as const,
};

export function useNotes(search?: string) {
  return useQuery<WorkspaceNoteSummary[]>({
    queryKey: noteKeys.list(search || ""),
    queryFn: () => getWorkspaceNotes(search),
    staleTime: 1000 * 60,
  });
}

export function useNote(id: string | null) {
  return useQuery<WorkspaceNoteDetail>({
    queryKey: noteKeys.detail(id!),
    queryFn: () => getWorkspaceNote(id!),
    enabled: !!id,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateWorkspaceNoteInput) => createWorkspaceNote(input),
    onSuccess: (newNote) => {
      queryClient.setQueryData<WorkspaceNoteSummary[]>(
        noteKeys.list(""),
        (old) => (old ? [newNote, ...old] : [newNote]),
      );
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: UpdateWorkspaceNoteInput;
    }) => updateWorkspaceNote(id, updates),
    onSuccess: (updatedNote, { id }) => {
      queryClient.setQueryData<WorkspaceNoteDetail>(
        noteKeys.detail(id),
        updatedNote,
      );
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteWorkspaceNote(id).then(() => id),
    onSuccess: (deletedId) => {
      queryClient.setQueryData<WorkspaceNoteSummary[]>(
        noteKeys.list(""),
        (old) => old?.filter((note) => note.id !== deletedId),
      );
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() });
    },
  });
}
