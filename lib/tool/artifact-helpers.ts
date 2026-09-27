import { ArtifactPayload, ArtifactType } from "@/lib/artifacts/types";

export function createArtifactPayload(
  type: ArtifactType,
  title: string,
  content: string,
  ext: string,
  metadata?: Record<string, unknown>,
): ArtifactPayload {
  return { type, title, content, ext, metadata };
}
