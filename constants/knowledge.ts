import { EMBEDDING_DIMENSIONS } from "./embeddings";

/** Owner kinds a knowledge chunk can belong to. */
export const KNOWLEDGE_OWNER_TYPES = ["agent", "chat"] as const;
export type KnowledgeOwnerType = (typeof KNOWLEDGE_OWNER_TYPES)[number];

export const KNOWLEDGE_TABLE = "knowledge_chunks";

/** Type discriminators for the mixed-type `documents` and `history` collections. */
export const CHAT_DOCUMENT_ATTRIBUTE = "CHAT_DOCUMENT";
export const CHAT_CITATION_ATTRIBUTE = "CHAT_CITATION";

export const KNOWLEDGE_INDEX_NAMES = {
  owner: "knowledge_chunks_owner_idx",
  user: "knowledge_chunks_user_idx",
  tsv: "knowledge_chunks_tsv_idx",
  embedding: "knowledge_chunks_embedding_idx",
} as const;

export const CHUNK_SIZE = 2000;
export const CHUNK_OVERLAP = 500;
export const CHUNK_SEPARATORS = ["\n\n", "\n", ". ", " ", ""] as const;

/** Reciprocal Rank Fusion constant. Standard value from the original RRF paper. */
export const RRF_K = 60;

/**
 * HNSW parameters. m=16 / ef_construction=64 is pgvector's documented starting
 * point, and the higher m is affordable here because the HNSW build happens
 * once, offline.
 */
export const HNSW_M = 16;
export const HNSW_EF_CONSTRUCTION = 64;

/**
 * The writer's replace statement, shared with scripts/check-knowledge.ts so the
 * check exercises the real statement rather than a copy. `$3` is the source
 * scope: NULL clears the whole owner, a value clears only that document's
 * chunks — which is what keeps a thread's other documents searchable when one
 * of them is re-uploaded.
 */
export const DELETE_CHUNKS_FOR_OWNER_SQL = `DELETE FROM ${KNOWLEDGE_TABLE}
       WHERE owner_type = $1 AND owner_id = $2
         AND ($3::text IS NULL OR source_id = $3)`;

/** The same replace, addressed by the document being deleted rather than by owner. */
export const DELETE_CHUNKS_FOR_SOURCE_SQL = `DELETE FROM ${KNOWLEDGE_TABLE}
     WHERE owner_type = $1 AND owner_id = $2 AND source_id = $3`;

/**
 * The writer's insert, shared with scripts/backfill-chunks.ts for the same
 * reason as the deletes: the script runs under `tsx`, where the `"server-only"`
 * modules do not resolve, and a duplicated statement would let the two drift.
 */
const VECTOR_TYPE = EMBEDDING_DIMENSIONS > 2000 ? "halfvec" : "vector";

export const INSERT_CHUNK_SQL = `INSERT INTO ${KNOWLEDGE_TABLE}
  (id, owner_type, owner_id, user_id, source_id, title, chunk_index, content, embedding)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::${VECTOR_TYPE})`;

/**
 * One statement, two rankings. The vector branch and the lexical branch are
 * computed independently and LEFT JOINed back to the rows, so a chunk found by
 * either arm survives; fusion happens in `combineRrf`, which only needs ranks.
 *
 * `websearch_to_tsquery` rather than `to_tsquery`: the query text comes from a
 * user, and `to_tsquery` raises a syntax error on `(`, `&`, `|` or `!`.
 *
 * `AND $1::vector IS NOT NULL` is load-bearing, not defensive. When the query
 * embedding fails, $1 is NULL; without this predicate the vector CTE still
 * matches every row with a non-null embedding, and `ROW_NUMBER()` numbers them
 * in an arbitrary order and is never NULL — so the arm would hand back
 * plausible-looking ranks for arbitrary chunks and pollute the fusion. With it,
 * a failed embedding leaves the arm empty and the lexical half carries the
 * query alone.
 *
 * `c.user_id = $6` is the authorization boundary, and the owner is not one. An
 * agent id is not a secret: the agent stream route passes the model whichever
 * agent id the request named, without checking that the caller owns it, so a
 * query scoped only by `owner_id` hands one user's chunks to another user who
 * names their agent. Every chunk carries the `user_id` that indexed it, and the
 * search must be the same user's.
 *
 * Parameters, in order: $1 query vector, $2 owner_type, $3 owner_id, $4 limit,
 * $5 query text, $6 the querying user.
 *
 * Lives here rather than in the module that runs it so the infrastructure check
 * can exercise this exact statement without importing a `server-only` module.
 */
export const KNOWLEDGE_SEARCH_SQL = `
  WITH vector_hits AS (
    SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::${VECTOR_TYPE}) AS vrank
    FROM ${KNOWLEDGE_TABLE} c
    WHERE c.owner_type = $2 AND c.owner_id = $3 AND c.user_id = $6
      AND c.embedding IS NOT NULL
      AND $1::${VECTOR_TYPE} IS NOT NULL
    ORDER BY c.embedding <=> $1::${VECTOR_TYPE}
    LIMIT $4
  ),
  lexical_hits AS (
    SELECT c.id,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.content_tsv, q) DESC) AS lrank
    FROM ${KNOWLEDGE_TABLE} c, websearch_to_tsquery('english', $5) q
    WHERE c.owner_type = $2 AND c.owner_id = $3 AND c.user_id = $6
      AND c.content_tsv @@ q
    -- Explicit, not redundant with the window's own ordering: it is this clause
    -- that decides which rows survive the LIMIT below. Without it the
    -- truncation is whatever the plan happens to produce, so the semantics would
    -- rest on the planner rather than on the statement.
    ORDER BY ts_rank_cd(c.content_tsv, q) DESC
    LIMIT $4
  )
  SELECT c.id, c.content, c.title, c.source_id, c.chunk_index, v.vrank, l.lrank
  FROM ${KNOWLEDGE_TABLE} c
  LEFT JOIN vector_hits v ON v.id = c.id
  LEFT JOIN lexical_hits l ON l.id = c.id
  WHERE v.id IS NOT NULL OR l.id IS NOT NULL
`;

/**
 * The DDL, as an ordered list of idempotent statements. Pure so it can be unit
 * tested without a database; the dimension is interpolated because `vector(n)`
 * cannot be parameterised.
 */
export function buildKnowledgeDdl(dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimensions: ${dimensions}`);
  }
  const isHalfVec = dimensions > 2000;
  const colType = isHalfVec ? `halfvec(${dimensions})` : `vector(${dimensions})`;
  const indexOps = isHalfVec ? "halfvec_cosine_ops" : "vector_cosine_ops";
  return [
    "CREATE EXTENSION IF NOT EXISTS vector",
    `CREATE TABLE IF NOT EXISTS ${KNOWLEDGE_TABLE} (
      id          text PRIMARY KEY,
      owner_type  text NOT NULL,
      owner_id    text NOT NULL,
      user_id     text NOT NULL,
      source_id   text,
      title       text,
      chunk_index integer NOT NULL,
      content     text NOT NULL,
      content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      embedding   ${colType},
      created_at  timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.owner}
      ON ${KNOWLEDGE_TABLE} (owner_type, owner_id)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.user}
      ON ${KNOWLEDGE_TABLE} (user_id)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.tsv}
      ON ${KNOWLEDGE_TABLE} USING gin (content_tsv)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.embedding}
      ON ${KNOWLEDGE_TABLE} USING hnsw (embedding ${indexOps})
      WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})`,
  ];
}
