import {
  CreateWorkspaceNoteInput,
  UpdateWorkspaceNoteInput,
  WorkspaceNoteDetail,
  WorkspaceNoteSummary,
} from "./types";

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawBody = await response.text();
  const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;

  if (!response.ok) {
    const payload =
      parsedBody && typeof parsedBody === "object"
        ? (parsedBody as ApiErrorPayload)
        : null;
    const message =
      payload?.error ||
      payload?.message ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return parsedBody as T;
}

export async function getWorkspaceNotes(
  search?: string,
): Promise<WorkspaceNoteSummary[]> {
  const params = new URLSearchParams();
  if (search?.trim()) {
    params.set("search", search.trim());
  }
  const query = params.toString();
  const response = await fetch(
    query ? `/api/workspace/notes?${query}` : "/api/workspace/notes",
    {
      cache: "no-store",
    },
  );
  return parseResponse<WorkspaceNoteSummary[]>(response);
}

export async function getWorkspaceNote(
  noteId: string,
): Promise<WorkspaceNoteDetail> {
  const response = await fetch(`/api/workspace/notes/${encodeURIComponent(noteId)}`, {
    cache: "no-store",
  });
  return parseResponse<WorkspaceNoteDetail>(response);
}

export async function createWorkspaceNote(
  input: CreateWorkspaceNoteInput,
): Promise<WorkspaceNoteDetail> {
  const response = await fetch("/api/workspace/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseResponse<WorkspaceNoteDetail>(response);
}

export async function updateWorkspaceNote(
  noteId: string,
  input: UpdateWorkspaceNoteInput,
): Promise<WorkspaceNoteDetail> {
  const response = await fetch(`/api/workspace/notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseResponse<WorkspaceNoteDetail>(response);
}

export async function deleteWorkspaceNote(noteId: string): Promise<void> {
  const response = await fetch(`/api/workspace/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
  await parseResponse<{ success: true }>(response);
}

