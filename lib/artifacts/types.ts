export type ArtifactType =
  | "image"
  | "file"
  | "chart"
  | "mermaid"
  | "canvas"
  | "code_interpreter";

export interface ArtifactSummary {
  id: string;
  type: ArtifactType;
  title: string;
  url: string;
  chatId?: string;
  createdAt: string;
}

export interface ArtifactDetail extends ArtifactSummary {
  metadata?: Record<string, unknown>;
}

export interface CreateArtifactInput {
  type: ArtifactType;
  title: string;
  url: string;
  metadata?: Record<string, unknown>;
  chatId?: string;
}

export interface ArtifactPayload {
  type: ArtifactType;
  title: string;
  /** The bytes to store. The writer uploads these and fills `url` with the ref. */
  content: string;
  ext: string;
  metadata?: Record<string, unknown>;
}
