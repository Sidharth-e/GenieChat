import "server-only";
import { KNOWLEDGE_SEARCH_SQL, RRF_K } from "@/constants/knowledge";
import { generateEmbedding } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getPostgresClient } from "@/lib/postgres/client";
import { toVectorLiteral } from "@/lib/postgres/vector";
import { combineRrf } from "./ranking";
import type { KnowledgeHit, KnowledgeOwnerType } from "./types";

export interface SearchKnowledgeParams {
  ownerType: KnowledgeOwnerType;
  ownerId: string;
  query: string;
  top?: number;
}

interface CandidateRow {
  id: string;
  content: string;
  title: string | null;
  source_id: string | null;
  chunk_index: number;
  vrank: string | null;
  lrank: string | null;
}

export async function searchKnowledge(
  params: SearchKnowledgeParams,
): Promise<KnowledgeHit[]> {
  const { ownerType, ownerId, query } = params;
  const top = Math.max(1, params.top ?? 5);
  const candidateLimit = top * 4;

  const trimmed = query.trim();
  if (!trimmed) return [];

  // A query can legitimately be too long to embed even after head/tail
  // truncation; the lexical arm still has something to say, so degrade rather
  // than fail the whole retrieval.
  let vectorLiteral: string | null = null;
  try {
    vectorLiteral = toVectorLiteral(await generateEmbedding(trimmed));
  } catch (error) {
    logger.error(
      { err: error, ownerType, ownerId },
      "Query embedding failed; falling back to lexical search only",
    );
  }

  const pool = await getPostgresClient();
  const { rows } = await pool.query<CandidateRow>(KNOWLEDGE_SEARCH_SQL, [
    vectorLiteral,
    ownerType,
    ownerId,
    candidateLimit,
    trimmed,
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  const vectorIds = rows
    .filter((row) => row.vrank !== null)
    .sort((a, b) => Number(a.vrank) - Number(b.vrank))
    .map((row) => row.id);
  const lexicalIds = rows
    .filter((row) => row.lrank !== null)
    .sort((a, b) => Number(a.lrank) - Number(b.lrank))
    .map((row) => row.id);

  const fused = combineRrf([vectorIds, lexicalIds], RRF_K);
  logger.info(
    {
      ownerType,
      ownerId,
      vectorHits: vectorIds.length,
      lexicalHits: lexicalIds.length,
      returned: Math.min(fused.length, top),
    },
    "Knowledge search complete",
  );

  return fused
    .map(({ id, score }) => {
      const row = byId.get(id);
      if (!row) return null;
      const hit: KnowledgeHit = {
        id,
        content: row.content,
        chunkIndex: row.chunk_index,
        score,
      };
      if (row.title) hit.title = row.title;
      if (row.source_id) hit.sourceId = row.source_id;
      return hit;
    })
    .filter((hit): hit is KnowledgeHit => hit !== null)
    .slice(0, top);
}
