import "server-only";
import { randomUUID } from "node:crypto";
import { KNOWLEDGE_TABLE } from "@/constants/knowledge";
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
 * Zero chunks is a valid input and still clears the owner's stale rows: an
 * empty document must leave nothing behind, not leave the previous version.
 */
export async function indexChunks(params: IndexChunksParams): Promise<number> {
  const { ownerType, ownerId, userId, sourceId, title, contents } = params;
  const shouldEmbed = params.embed ?? true;
  const pool = await getPostgresClient();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = $2`,
      [ownerType, ownerId],
    );

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
  const result = await pool.query(
    `DELETE FROM ${KNOWLEDGE_TABLE} WHERE owner_type = $1 AND owner_id = $2`,
    [ownerType, ownerId],
  );
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
