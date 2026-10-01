import "server-only";

import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { logger } from "@/lib/logger";
import { generateId } from "@/lib/utils";
import { putObject } from "@/lib/storage";
import { keyForUser } from "@/lib/storage/ref";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { ArtifactPayload } from "./types";

const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

export async function saveToolArtifact(
  userId: string,
  payload: ArtifactPayload,
  chatId?: string,
): Promise<void> {
  if (!artifactStore) return;

  const { content, ext, ...rest } = payload;

  const uploaded = await putObject(
    STORAGE_BUCKETS.artifacts,
    keyForUser(userId, payload.type, `${generateId()}.${ext}`),
    Buffer.from(content, "utf-8"),
  );

  if (uploaded.status !== "OK") {
    logger.error({ err: uploaded }, "Failed to upload artifact");
    return;
  }

  try {
    await artifactStore.createArtifact(userId, {
      ...rest,
      url: uploaded.response,
      chatId,
    });
  } catch (error) {
    logger.error("Failed to save artifact:", error);
  }
}
