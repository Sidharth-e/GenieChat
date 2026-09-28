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
