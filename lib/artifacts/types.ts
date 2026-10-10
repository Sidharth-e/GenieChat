export type ArtifactType =
  | "image"
  | "video"
  | "file"
  | "chart"
  | "mermaid"
  | "canvas"
  | "scancode"
  | "code_sandbox";

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

/**
 * An artifact whose bytes are already in object storage.
 *
 * The upload variant carries its bytes through the tool result, which is both
 * streamed to the client and persisted in the message — fine for a chart config
 * or a scancode's SVG, ruinous for a multi-megabyte image. A producer that holds
 * binary uploads it itself and hands back only the ref.
 */
export interface StoredArtifact {
  type: ArtifactType;
  title: string;
  /** The `s3://` ref the producer already wrote. */
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * What a tool result may carry in `_artifact` / `_artifacts`. Discriminated by
 * `url` (already stored) versus `content` (still to upload), which is the
 * branch `saveToolArtifact` takes.
 */
export type ArtifactEnvelope = ArtifactPayload | StoredArtifact;
