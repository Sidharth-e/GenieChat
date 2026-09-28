import type { MemoryCategory } from "@/lib/types";

export const MEMORY_VECTOR_INDEX_NAMES = {
  memory: "memory_embedding",
  entity: "entity_embedding",
} as const;

export const MEMORY_CONSTRAINT_NAMES = {
  memoryId: "memory_id",
  entityId: "entity_id",
  entityUserName: "entity_user_name",
} as const;

/**
 * The schema, as an ordered list of idempotent statements. Pure so it can be
 * unit tested without a server; the dimension is interpolated because
 * `vector.dimensions` is a literal in the index config.
 */
export function buildNeo4jDdl(dimensions: number): string[] {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid embedding dimensions: ${dimensions}`);
  }
  return [
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.memoryId} IF NOT EXISTS
       FOR (m:Memory) REQUIRE m.id IS UNIQUE`,
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityId} IF NOT EXISTS
       FOR (e:Entity) REQUIRE e.id IS UNIQUE`,
    // The entity-resolution key *and* the thing that keeps two users' "Acme"
    // from becoming one node. Both matter.
    `CREATE CONSTRAINT ${MEMORY_CONSTRAINT_NAMES.entityUserName} IF NOT EXISTS
       FOR (e:Entity) REQUIRE (e.userId, e.normalizedName) IS UNIQUE`,
    `CREATE INDEX memory_user IF NOT EXISTS FOR (m:Memory) ON (m.userId)`,
    `CREATE INDEX memory_enriched IF NOT EXISTS FOR (m:Memory) ON (m.enrichedAt)`,
    `CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.memory} IF NOT EXISTS
       FOR (m:Memory) ON m.embedding
       WITH [m.userId]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
    `CREATE VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.entity} IF NOT EXISTS
       FOR (e:Entity) ON e.embedding
       WITH [e.userId]
       OPTIONS { indexConfig: {
         \`vector.dimensions\`: ${dimensions},
         \`vector.similarity_function\`: 'cosine'
       }}`,
  ];
}

/**
 * The categories a memory may carry, and the runtime half of the
 * `MemoryCategory` union in `lib/types.ts`. Moved here from the retired
 * `vector-memory-store.ts`, which validated every write against it and is
 * deleted whole: typed as `Set<MemoryCategory>` so narrowing the union fails to
 * compile here rather than silently rejecting a category the UI still offers.
 */
export const MEMORY_CATEGORIES: Set<MemoryCategory> = new Set([
  "preference",
  "fact",
  "instruction",
  "professional",
  "other",
]);

/** Carried over from the retired `vector-memory-store.ts`, unchanged. */
export const MEMORY_EDGE_THRESHOLD = 0.2;
export const MEMORY_EDGE_NEIGHBOR_LIMIT = 12;
export const MEMORY_SEED_MULTIPLIER = 3;
export const MEMORY_MIN_TOKEN_LENGTH = 3;
export const MEMORY_MAX_CONCEPT_FEATURES = 24;

/** New. High by design: only near-duplicate entities should collapse. */
export const MEMORY_ENTITY_MERGE_THRESHOLD = 0.9;

/** Parity with the old GRAPH_SECOND_HOP_LIMIT: two hops, as today. */
export const MEMORY_RECALL_HOPS = 2;

/** Replaces the two hard-coded hop decays that were fused into the old blend. */
export const MEMORY_TRAVERSAL_DECAY = 0.6;

export const MEMORY_SEED_MIN = 15;

/**
 * The seed similarity and the graph path are the two things worth weighting,
 * now that the edges are real rather than heuristic. This replaces the retired
 * five-way blend, which fused scores that only existed because the graph was a
 * guess.
 */
export const MEMORY_WEIGHT_SEED = 0.7;
export const MEMORY_WEIGHT_GRAPH = 0.3;

export const MEMORY_RELATION_TYPES = [
  "ABOUT",
  "RELATES_TO",
  "SUPERSEDES",
  "CONTRADICTS",
] as const;
export type MemoryRelationType = (typeof MEMORY_RELATION_TYPES)[number];

/**
 * The four types the graph walk is allowed to traverse. Kept as a Set so the
 * Cypher parameter is built from one source.
 */
export const MEMORY_TRAVERSABLE_TYPES: string[] = [...MEMORY_RELATION_TYPES];

/** Carried over verbatim from the retired `vector-memory-store.ts`. */
export const MEMORY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "about",
  "have",
  "will",
  "just",
  "into",
  "than",
  "them",
  "they",
  "their",
  "there",
  "what",
  "when",
  "where",
  "which",
  "while",
  "been",
  "being",
  "does",
  "did",
  "dont",
  "can't",
  "cant",
  "should",
  "could",
  "would",
  "please",
  "user",
]);

export function memorySeedLimit(top: number): number {
  return Math.max(top * MEMORY_SEED_MULTIPLIER, MEMORY_SEED_MIN);
}

/**
 * Bound on the retrieval query string. Moved out of the store so the pure text
 * primitives can read it without importing the Azure module.
 */
export const MEMORY_MAX_QUERY_CHARS = 24_000;

/** Joins the kept head and tail of a truncated retrieval query. */
export const MEMORY_QUERY_SEPARATOR = "\n...\n";
