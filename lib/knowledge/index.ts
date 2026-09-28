import "server-only";
import { randomUUID } from "node:crypto";
import {
  DELETE_CHUNKS_FOR_OWNER_SQL,
  DELETE_CHUNKS_FOR_SOURCE_SQL,
  INSERT_CHUNK_SQL,
  KNOWLEDGE_TABLE,
} from "@/constants/knowledge";
import { generateEmbedding } from "@/lib/embeddings";
import { getPostgresClient } from "@/lib/postgres/client";
import { toVectorLiteral } from "@/lib/postgres/vector";
import { logger } from "@/lib/logger";
import { embedChunkRows } from "./embed";
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
 *
 * Embedding happens before the transaction opens, not inside it: the delete
 * below holds row locks on this owner, and a long document would hold them
 * across one HTTP round trip per chunk. See `embedChunkRows`.
 */
export async function indexChunks(params: IndexChunksParams): Promise<number> {
  const { ownerType, ownerId, userId, sourceId, title, contents } = params;
  const shouldEmbed = params.embed ?? true;
  const pool = await getPostgresClient();

  const { rows, failures } = await embedChunkRows(
    contents,
    shouldEmbed ? generateEmbedding : undefined,
  );
  for (const failure of failures) {
    logger.error(
      { err: failure.error, ownerType, ownerId, chunkIndex: failure.chunkIndex },
      "Failed to embed chunk; storing it without a vector",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(DELETE_CHUNKS_FOR_OWNER_SQL, [
      ownerType,
      ownerId,
      sourceId ?? null,
    ]);

    for (const row of rows) {
      await client.query(INSERT_CHUNK_SQL, [
        randomUUID(),
        ownerType,
        ownerId,
        userId,
        sourceId ?? null,
        title ?? null,
        row.chunkIndex,
        row.content,
        row.embedding ? toVectorLiteral(row.embedding) : null,
      ]);
    }

    await client.query("COMMIT");
    logger.info(
      { ownerType, ownerId, inserted: rows.length, cleared: true },
      "Indexed knowledge chunks",
    );
    return rows.length;
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
