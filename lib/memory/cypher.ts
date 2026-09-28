/**
 * The statements that define the memory graph's read, delete and garbage-collect
 * behaviour, kept out of `graph-store.ts` so that `scripts/check-memory.ts` can
 * execute the *same* Cypher the store does.
 *
 * That is the whole reason this module exists. The store is `"server-only"`, so
 * a check script cannot import it; if the script carried its own copy of these
 * statements it would be verifying the copy. Nothing here may import a
 * `"server-only"` module, or the script stops working and this module stops
 * being worth having.
 */
import {
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_RECALL_HOPS,
  MEMORY_VECTOR_INDEX_NAMES,
  type MemoryLlmEdgeType,
} from "@/constants/memory";

/**
 * Numeric parameters are all Double on the wire. The driver packs every plain
 * JS number as a Float64, so a standalone `LIMIT $n` raises
 * `22003: '30.0' is not a valid value` — the number is right and the *type* is
 * wrong. Every standalone LIMIT below therefore coerces with `toInteger($n)`,
 * which keeps callers passing plain numbers instead of driver `Integer`s and
 * keeps the trap from reappearing at the next LIMIT someone adds.
 *
 * `SEED_CYPHER` is the exception, and only because it does not need the coercion:
 * its `LIMIT $k` sits inside the SEARCH clause, whose restricted grammar takes
 * the value as a plain number and accepts the Float.
 */

/**
 * In-index filtering, not post-filtering. `CALL db.index.vector.queryNodes`
 * returns the top-K *globally* and only then would a WHERE discard other
 * tenants — so a user whose memories are less similar than another user's gets
 * crowded out and can receive nothing despite having valid matches. The WHERE
 * inside SEARCH keeps the index scanning until it has $k matching rows.
 *
 * The inner WHERE is a restricted subset: equality and AND only. Adding a
 * `<>`, an OR or a string operator here fails with error 22ND3.
 */
export const SEED_CYPHER = `
  MATCH (m:Memory)
    SEARCH m IN (
      VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.memory}
      FOR $queryVector
      WHERE m.userId = $userId
      LIMIT $k
    ) SCORE AS vectorScore
  RETURN m.id AS id, m.content AS content, m.category AS category,
         m.userName AS userName, m.userEmail AS userEmail,
         m.createdAt AS createdAt, m.updatedAt AS updatedAt,
         vectorScore
`;

// Cypher does not accept a parameter for a variable-length bound — `*1..$hops`
// is a syntax error, verified against the live server. The bound is therefore
// interpolated, which is only safe because it is a literal constant; the guard
// below is what keeps that true if the constant is ever changed.
if (!Number.isInteger(MEMORY_RECALL_HOPS) || MEMORY_RECALL_HOPS < 1) {
  throw new Error(`MEMORY_RECALL_HOPS must be a positive integer, got ${MEMORY_RECALL_HOPS}`);
}

/**
 * Every hop is re-checked with all(x IN nodes(path) ...), which is the
 * defence-in-depth for the seed's in-index filter: even a shared entity can
 * never bridge two users. ABOUT is in $allowedTypes, so Memory->Entity->Memory
 * paths fall out of the same pattern rather than needing a second query.
 */
export const EXPAND_CYPHER = `
  MATCH path = (seed:Memory)-[rels*1..${MEMORY_RECALL_HOPS}]-(n:Memory)
  WHERE seed.id IN $seedIds
    AND n.userId = $userId
    AND all(x IN nodes(path) WHERE x.userId = $userId)
    AND all(r IN rels WHERE type(r) IN $allowedTypes)
  RETURN n.id AS id, n.content AS content, n.category AS category,
         n.userName AS userName, n.userEmail AS userEmail,
         n.createdAt AS createdAt, n.updatedAt AS updatedAt,
         length(path) AS hops,
         reduce(w = 1.0, r IN rels | w * coalesce(r.weight, 1.0)) AS pathWeight
  ORDER BY pathWeight DESC
  LIMIT toInteger($expansionLimit)
`;

/**
 * The candidate window the deterministic edge pass scores a new memory against:
 * the most recent other memories of the same user, ordered so the window is a
 * stable recent slice rather than an arbitrary one. `MEMORY_EDGE_CANDIDATE_LIMIT`
 * holds the bound and the reasoning for it.
 */
export const EDGE_CANDIDATE_CYPHER = `
  MATCH (other:Memory {userId: $userId})
  WHERE other.id <> $id
  RETURN other.id AS id, other.content AS content
  ORDER BY other.createdAt DESC
  LIMIT toInteger($limit)
`;

/** DETACH, so the memory's edges go with it. */
export const MEMORY_DELETE_CYPHER = `
  MATCH (m:Memory {id: $id, userId: $userId}) DETACH DELETE m
`;

/**
 * Without this, entities accumulate forever: a leak this design would otherwise
 * introduce. Scoped by userId, which is indexed.
 */
export const ENTITY_GC_CYPHER = `
  MATCH (e:Entity {userId: $userId})
  WHERE NOT (e)<-[:ABOUT]-(:Memory)
  DETACH DELETE e
`;

/**
 * Both entity writers MERGE on `(userId, normalizedName)` and link with ABOUT —
 * the deterministic pass under the name it extracted, the enrichment pass under
 * the name it *resolved* to. One statement, because they would otherwise be the
 * same statement written twice, and the check script can only cover what lives
 * here.
 */
/**
 * The migration's write, lifted here so the script and the store's writers
 * share one definition rather than the script carrying its own copy of the
 * shape.
 *
 * `enrichedAt = null` sits under `ON CREATE SET` because the migration is
 * documented as safe to re-run. The nodes are `MERGE`d either way, but a plain
 * `SET m.enrichedAt = null` would re-open the *entire* corpus to the enrichment
 * sweep on every run — one model call per memory — which is not what an
 * operator running a re-migration is agreeing to.
 */
export const MIGRATE_MEMORY_CYPHER = `
  MERGE (m:Memory {id: $id})
  SET m.userId = $userId,
      m.userName = $userName,
      m.userEmail = $userEmail,
      m.content = $content,
      m.category = $category,
      m.createdAt = $createdAt,
      m.updatedAt = $updatedAt,
      m.embedding = $embedding
  ON CREATE SET m.enrichedAt = null
`;

export const ENTITY_ABOUT_CYPHER = `
  MATCH (m:Memory {id: $id, userId: $userId})
  MERGE (e:Entity {userId: $userId, normalizedName: $normalizedName})
    ON CREATE SET e.id = $entityId,
                  e.name = $name,
                  e.createdAt = $now,
                  e.embedding = $embedding
    ON MATCH SET e.embedding = coalesce(e.embedding, $embedding)
  MERGE (m)-[:ABOUT]->(e)
`;

/** Resolution step 1: the exact `(userId, normalizedName)` constraint match. */
export const ENTITY_EXACT_CYPHER = `
  MATCH (e:Entity {userId: $userId, normalizedName: $normalizedName})
  RETURN e.id AS id
`;

/**
 * Resolution step 2: the nearest existing entity of this user, when it is close
 * enough to be the same thing. In-index filtered for the reason SEED_CYPHER is —
 * a post-filter would score every tenant's entities against each other — and
 * `LIMIT 1` because only the nearest is ever used; the threshold is checked
 * outside, so a nearest that is *not* close enough correctly resolves to
 * nothing and the caller creates the entity instead.
 */
export const ENTITY_NEAREST_CYPHER = `
  MATCH (e:Entity)
    SEARCH e IN (
      VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.entity}
      FOR $vector
      WHERE e.userId = $userId
      LIMIT 1
    ) SCORE AS score
  WHERE score >= $threshold
  RETURN e.normalizedName AS normalizedName, score
`;

/**
 * Entity-to-entity relations are one generic `:RELATION` carrying its type as a
 * property, not three relationship types. That is what lets the type stay a
 * parameter: the memory→memory types in `buildMemoryEdgeCypher` cannot, because
 * `EXPAND_CYPHER` filters on `type(r)` and so they must *be* the type.
 */
export const RELATION_CYPHER = `
  UNWIND $relations AS rel
  MATCH (a:Entity {userId: $userId, normalizedName: rel.from})
  MATCH (b:Entity {userId: $userId, normalizedName: rel.to})
  MERGE (a)-[r:RELATION]->(b)
    ON CREATE SET r.type = rel.type, r.createdAt = $now
`;

/**
 * The model's own memory→memory edges, one statement per permitted type —
 * the type has to be the relationship type, and Cypher cannot parameterise
 * one, so it is interpolated behind a runtime check.
 *
 * The `MATCH` on the target is doing three jobs at once: it drops an edge whose
 * target id does not exist, drops one belonging to another user, and drops one
 * the model invented. A dangling `MERGE` would create a second `:Memory` node
 * with that id and hang an edge on it.
 */
export function buildMemoryEdgeCypher(type: MemoryLlmEdgeType): string {
  if (!MEMORY_LLM_EDGE_TYPES.includes(type)) {
    throw new Error(
      `"${type}" is not a permitted memory edge type; permitted: ${MEMORY_LLM_EDGE_TYPES.join(", ")}`,
    );
  }
  return `
    MATCH (m:Memory {id: $id, userId: $userId})
    UNWIND $edges AS edge
    MATCH (other:Memory {id: edge.targetId, userId: $userId})
    MERGE (m)-[r:${type}]->(other)
      ON CREATE SET r.reason = edge.reason, r.createdAt = $now
  `;
}

/**
 * The marker that makes enrichment a one-shot per memory, and the predicate the
 * sweep reads. Set even when the extraction was empty: "asked and there was
 * nothing" is a different fact from "never asked", and only the second should
 * keep costing a model call on every sweep.
 */
export const MEMORY_ENRICHED_AT_CYPHER = `
  MATCH (m:Memory {id: $id, userId: $userId})
  SET m.enrichedAt = $now
`;

/**
 * The sweep's selection: every memory the model has not seen, plus every memory
 * written without a vector because the embedding provider was down (§8). One
 * command, two recovery paths.
 */
export const ENRICH_PENDING_CYPHER = `
  MATCH (m:Memory)
  WHERE m.enrichedAt IS NULL OR m.embedding IS NULL
  RETURN m.id AS id, m.userId AS userId, m.content AS content,
         m.embedding IS NULL AS vectorless
  LIMIT toInteger($limit)
`;

/**
 * The other half of the sweep's recovery. `embedding IS NULL` selects a memory
 * written while the provider was down, and selecting it is only worth doing if
 * something then clears the predicate — otherwise every run re-enriches the
 * same memories, at a model call each.
 */
export const MEMORY_EMBEDDING_CYPHER = `
  MATCH (m:Memory {id: $id, userId: $userId})
  SET m.embedding = $embedding
`;
