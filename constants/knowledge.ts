/** Owner kinds a knowledge chunk can belong to. */
export const KNOWLEDGE_OWNER_TYPES = ["agent", "chat"] as const;
export type KnowledgeOwnerType = (typeof KNOWLEDGE_OWNER_TYPES)[number];

export const KNOWLEDGE_TABLE = "knowledge_chunks";

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
 * point and is a better recall/latency trade than Azure's m=4 here because the
 * HNSW build happens once, offline.
 */
export const HNSW_M = 16;
export const HNSW_EF_CONSTRUCTION = 64;

/**
 * The DDL, as an ordered list of idempotent statements. Pure so it can be unit
 * tested without a database; the dimension is interpolated because `vector(n)`
 * cannot be parameterised.
 */
export function buildKnowledgeDdl(dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimensions: ${dimensions}`);
  }
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
      embedding   vector(${dimensions}),
      created_at  timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.owner}
      ON ${KNOWLEDGE_TABLE} (owner_type, owner_id)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.user}
      ON ${KNOWLEDGE_TABLE} (user_id)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.tsv}
      ON ${KNOWLEDGE_TABLE} USING gin (content_tsv)`,
    `CREATE INDEX IF NOT EXISTS ${KNOWLEDGE_INDEX_NAMES.embedding}
      ON ${KNOWLEDGE_TABLE} USING hnsw (embedding vector_cosine_ops)
      WITH (m = ${HNSW_M}, ef_construction = ${HNSW_EF_CONSTRUCTION})`,
  ];
}
