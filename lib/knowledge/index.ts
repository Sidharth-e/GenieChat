import "server-only";
import { randomUUID } from "node:crypto";
import {
  DELETE_CHUNKS_FOR_OWNER_SQL,
  DELETE_CHUNKS_FOR_SOURCE_SQL,
  KNOWLEDGE_TABLE,
} from "@/constants/knowledge";
import { generateEmbedding } from "@/lib/embeddings";
import { getPostgresClient } from "@/lib/postgres/client";
import { toVectorLiteral } from "@/lib/postgres/vector";
import { logger } from "@/lib/logger";
import type { IndexChunksParams, KnowledgeOwnerType } from "./types";

/**
 * Replace, not append. Chunk ids are generated fresh on every call, so an
 * append would silently double the owner's rows on any retry, backfill re-run
 * or re-upload. Deleting first makes idempotency structural instead of a
 * promise each caller has to keep.
 *
 * The delete is scoped by `sourceId` when one is given. A chat owner is a
 * thread, and a thread holds chunks from every document uploaded to it, so
 * replacing the whole owner on each upload would make the second file wipe the
 * first file's chunks — a silent loss, and one the search path could not even
 * report, since the rows would simply be gone. With a source, only that
 * document's chunks are replaced and the thread's other documents survive.
 * Without one, the caller is replacing the owner itself and the whole owner is
 * cleared, as before.
 *
 * Zero chunks is a valid input and still clears what the same scope covered: an
 * empty document must leave nothing behind, not leave the previous version.
 */
export async function indexChunks(params: IndexChunksParams): Promise<number> {
  const { ownerType, ownerId, userId, sourceId, title, contents } = params;
  const shouldEmbed = params.embed ?? true;
  const pool = await getPostgresClient();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(DELETE_CHUNKS_FOR_OWNER_SQL, [
      ownerType,
      ownerId,
      sourceId ?? null,
    ]);

    let inserted = 0;
    for (let index = 0; index < contents.length; index += 1) {
      const content = contents[index].trim();
      if (!content) continue;

      let embedding: number[] | null = null;
      if (shouldEmbed) {
        try {
          embedding = await generateEmbedding(content);
        } catch (error) {
          // A knowledge base that is searchable lexically beats a failed upload.
          logger.error(
            { err: error, ownerType, ownerId, chunkIndex: index },
            "Failed to embed chunk; storing it without a vector",
          );
        }
      }

      await client.query(
        `INSERT INTO ${KNOWLEDGE_TABLE}
           (id, owner_type, owner_id, user_id, source_id, title, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
        [
          randomUUID(),
          ownerType,
          ownerId,
          userId,
          sourceId ?? null,
          title ?? null,
          index,
          content,
          embedding ? toVectorLiteral(embedding) : null,
        ],
      );
      inserted += 1;
    }

    await client.query("COMMIT");
    logger.info(
      { ownerType, ownerId, inserted, cleared: true },
      "Indexed knowledge chunks",
    );
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteChunksForOwner(
  ownerType: KnowledgeOwnerType,
  ownerId: string,
): Promise<number> {
  const pool = await getPostgresClient();
  const result = await pool.query(DELETE_CHUNKS_FOR_OWNER_SQL, [
    ownerType,
    ownerId,
    null,
  ]);
  return result.rowCount ?? 0;
}

export async function deleteChunksForOwners(
  ownerType: KnowledgeOwnerType,
  ownerIds: string[],
): Promise<number> {
  if (ownerIds.length === 0) return 0;
  const pool = await getPostgresClient();
  const result = await pool.query(
    `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = ANY($2::text[])`,
    [ownerType, ownerIds],
  );
  return result.rowCount ?? 0;
}

/**
 * Deleting a document is not the same as deleting its owner. A chat thread's
 * chunks are its documents' chunks, so removing one document must leave the
 * thread's other documents searchable — hence the `source_id` conjunct rather
 * than `deleteChunksForOwner`.
 */
export async function deleteChunksForSource(
  ownerType: KnowledgeOwnerType,
  ownerId: string,
  sourceId: string,
): Promise<number> {
  const pool = await getPostgresClient();
  const result = await pool.query(DELETE_CHUNKS_FOR_SOURCE_SQL, [
    ownerType,
    ownerId,
    sourceId,
  ]);
  return result.rowCount ?? 0;
}
