import "server-only";

import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { logger } from "@/lib/logger";
import { generateId } from "@/lib/utils";
import { putObject } from "@/lib/storage";
import { keyForUser } from "@/lib/storage/ref";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { ArtifactEnvelope } from "./types";

const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

/**
 * Records an artifact a tool produced.
 *
 * Two paths, split by whether the producer still holds the bytes. A text
 * artifact arrives as `content` and is uploaded here; one whose bytes were
 * already written — an image, whose base64 would otherwise bloat the tool result
 * on the wire and in the message — arrives as a `url` and is recorded as is.
 */
export async function saveToolArtifact(
  userId: string,
  payload: ArtifactEnvelope,
  chatId?: string,
): Promise<void> {
  if (!artifactStore) return;

  if ("url" in payload) {
    try {
      await artifactStore.createArtifact(userId, { ...payload, chatId });
    } catch (error) {
      logger.error("Failed to save artifact:", error);
    }
    return;
  }

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
