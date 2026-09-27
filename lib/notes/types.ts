export interface WorkspaceNoteSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNoteDetail extends WorkspaceNoteSummary {
  content: string;
}

export interface CreateWorkspaceNoteInput {
  title: string;
  content: string;
}

export interface UpdateWorkspaceNoteInput {
  title?: string;
  content?: string;
}

