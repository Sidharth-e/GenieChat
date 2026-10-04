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
 * The seed statements are the exception, and only because they do not need the
 * coercion: their `LIMIT $k` sits inside the SEARCH clause, whose restricted
 * grammar takes the value as a plain number and accepts the Float.
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
      VECTOR INDEX "memory_embedding"
      FOR $queryVector
      WHERE m.userId = $userId
      LIMIT $k
    ) SCORE AS vectorScore
  RETURN m.id AS id, m.content AS content,
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
  RETURN n.id AS id, n.content AS content,
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

/**
 * The graph view's four reads. Everything they return is drawn, so each one is
 * bounded — an unbounded read here is a browser tab that stops responding
 * rather than a slow query.
 *
 * `GRAPH_MEMORIES_CYPHER` is the only one that decides *which* memories are in
 * the window: newest first, capped. The other three are scoped to that set by
 * id, which is what keeps the drawn edges exactly those whose endpoints are
 * drawn. Without that scoping an edge would arrive pointing at a node the
 * window excluded and React Flow would drop it silently, leaving a node whose
 * degree the view reported as higher than the picture shows.
 */
export const GRAPH_MEMORIES_CYPHER = `
  MATCH (m:Memory {userId: $userId})
  RETURN m.id AS id, m.content AS content, m.createdAt AS createdAt
  ORDER BY m.createdAt DESC
  LIMIT toInteger($limit)
`;

/**
 * How many memories the user actually has, against the capped read above. The
 * view tells the reader when it is showing a window rather than the whole
 * corpus, and that is only honest with a real count: inferring it from
 * "the read returned exactly the limit" reports truncation for a user who
 * happens to have exactly that many memories.
 */
export const GRAPH_MEMORY_COUNT_CYPHER = `
  MATCH (m:Memory {userId: $userId})
  RETURN count(m) AS total
`;

/**
 * `e.userId` is checked on the entity as well as the memory. ABOUT is only ever
 * written within one tenant, so the check cannot fail today — it is here
 * because the statement is what would silently become a cross-tenant read if a
 * future writer merged an entity across users.
 */
export const GRAPH_ABOUT_CYPHER = `
  MATCH (m:Memory {userId: $userId})-[r:ABOUT]->(e:Entity {userId: $userId})
  WHERE m.id IN $memoryIds
  RETURN m.id AS memoryId, e.id AS entityId, e.name AS entityName,
         e.normalizedName AS normalizedName
`;

/**
 * `type(r)` is filtered rather than matched to one relationship type, because
 * Cypher cannot parameterise a type and writing one branch per type would mean
 * a new edge type is invisible here until someone remembers to add it. The
 * permitted set is passed in, mirroring `EXPAND_CYPHER`.
 *
 * The `IN` on both ids is a second filter on top of the tenant check, not a
 * replacement for it: the edges are already tenant-scoped by the pattern, and
 * the id lists are what bound the result to the drawn window.
 */
export const GRAPH_MEMORY_EDGES_CYPHER = `
  MATCH (a:Memory {userId: $userId})-[r]->(b:Memory {userId: $userId})
  WHERE type(r) IN $edgeTypes
    AND a.id IN $memoryIds
    AND b.id IN $memoryIds
  RETURN a.id AS source, b.id AS target, type(r) AS type,
         r.weight AS weight, r.reason AS reason
`;

/**
 * Entity-to-entity relations. One generic `:RELATION` carrying its type as a
 * property (see `RELATION_CYPHER`), so `type(r)` here is always `RELATION` and
 * the interesting value is `r.type` — hence the alias.
 */
export const GRAPH_ENTITY_RELATIONS_CYPHER = `
  MATCH (a:Entity {userId: $userId})-[r:RELATION]->(b:Entity {userId: $userId})
  WHERE a.id IN $entityIds
    AND b.id IN $entityIds
  RETURN a.id AS source, b.id AS target, r.type AS relationType
`;

/* -------------------------------------------------------------------------- */
/* The fact graph                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The anchor, created lazily on the first write. The name and email live here
 * and nowhere else: they are display data fetched once per batch, and copying
 * them onto every fact would go stale on rename for no query value.
 */
export const USER_UPSERT_CYPHER = `
  MERGE (u:User {id: $userId})
  SET u.name = $name, u.email = $email
`;

/** CREATE, not MERGE: a capture is an event, and two identical events are two rows. */
export const CAPTURE_CREATE_CYPHER = `
  CREATE (c:Capture {
    id: $id, userId: $userId, text: $text,
    embedding: $embedding, createdAt: $createdAt, attempts: 0
  })
`;

/**
 * The sweep's worklist. Ordered oldest-first so a backlog drains in the order it
 * arrived, and bounded by `attempts` so a capture the model cannot read stops
 * costing a call.
 */
export const CAPTURE_PENDING_CYPHER = `
  MATCH (c:Capture {userId: $userId})
  WHERE c.attempts < $maxAttempts
  RETURN c.id AS id, c.text AS text, c.embedding AS embedding,
         c.createdAt AS createdAt
  ORDER BY c.createdAt ASC
  LIMIT toInteger($limit)
`;

export const CAPTURE_RETRY_CYPHER = `
  MATCH (c:Capture {id: $id, userId: $userId})
  SET c.attempts = c.attempts + 1
`;

/** The capture is gone once its facts exist — it was staging, not a record. */
export const CAPTURE_DELETE_CYPHER = `
  MATCH (c:Capture {id: $id, userId: $userId}) DETACH DELETE c
`;

/** Resolution step 1: the exact `(userId, normalizedName)` constraint match. */
export const ENTITY_EXACT_CYPHER = `
  MATCH (e:Entity {userId: $userId, normalizedName: $normalizedName})
  RETURN e.id AS id, e.name AS name
`;

/**
 * Resolution step 2: the nearest existing entity of this user, when it is close
 * enough to be the same thing. In-index filtered for the reason SEED_CYPHER is —
 * a post-filter would score every tenant's entities against each other — and
 * `LIMIT 1` because only the nearest is ever used. The threshold filters in
 * Cypher rather than in the caller, so a nearest that is *not* close enough
 * correctly resolves to nothing and the caller creates the entity instead.
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
  RETURN e.id AS id, e.name AS name, e.normalizedName AS normalizedName, score
`;

export const ENTITY_CREATE_CYPHER = `
  MERGE (e:Entity {userId: $userId, normalizedName: $normalizedName})
  ON CREATE SET e.id = $id, e.name = $name, e.embedding = $embedding, e.aliases = []
  ON MATCH SET e.embedding = coalesce(e.embedding, $embedding)
  RETURN e.id AS id
`;

/**
 * Recording the surface form is what makes the vocabulary inspectable: without
 * it, a node called `APPLE_INC` gives no clue which phrasings feed it.
 */
export const ENTITY_ALIAS_CYPHER = `
  MATCH (e:Entity {id: $id, userId: $userId})
  SET e.aliases = CASE
    WHEN $alias IN e.aliases THEN e.aliases
    ELSE e.aliases + $alias
  END
`;

/**
 * A `:Value` is the object of a fact that is not an entity — an instruction, a
 * literal. Merged on its text, so the same value asserted twice is one node.
 */
export const VALUE_MERGE_CYPHER = `
  MERGE (v:Value {userId: $userId, text: $text})
  ON CREATE SET v.id = $id
  RETURN v.id AS id
`;

export const PREDICATE_EXACT_CYPHER = `
  MATCH (p:Predicate {userId: $userId, canonicalName: $canonicalName})
  RETURN p.id AS id, p.canonicalName AS canonicalName
`;

/** Embedded from `predicateEmbeddingText`, so the relation carries the meaning. */
export const PREDICATE_NEAREST_CYPHER = `
  MATCH (p:Predicate)
    SEARCH p IN (
      VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.predicate}
      FOR $embedding
      WHERE p.userId = $userId
      LIMIT 1
    ) SCORE AS score
  RETURN p.id AS id, p.canonicalName AS canonicalName, score
`;

export const PREDICATE_CREATE_CYPHER = `
  MERGE (p:Predicate {userId: $userId, canonicalName: $canonicalName})
  ON CREATE SET p.id = $id, p.embedding = $embedding, p.aliases = [], p.factCount = 0
  ON MATCH SET p.embedding = coalesce(p.embedding, $embedding)
  RETURN p.id AS id
`;

export const PREDICATE_ALIAS_CYPHER = `
  MATCH (p:Predicate {id: $id, userId: $userId})
  SET p.aliases = CASE
    WHEN $alias IN p.aliases THEN p.aliases
    ELSE p.aliases + $alias
  END
`;

/** The merge sweep's candidate set and the extractor's vocabulary hint. */
export const PREDICATE_LIST_CYPHER = `
  MATCH (p:Predicate {userId: $userId})
  RETURN p.id AS id, p.canonicalName AS canonicalName,
         p.embedding AS embedding, p.aliases AS aliases, p.factCount AS factCount
  ORDER BY p.factCount DESC
`;

/**
 * Rewire, fold the alias in, count the facts moved, then drop the duplicate.
 *
 * `OPTIONAL MATCH` because a predicate with no facts must still merge — a plain
 * MATCH would leave the loser behind forever. `DELETE r` on a null relationship
 * is a no-op, and `count(f)` counts only the non-null rows, so the factCount
 * bump tracks the facts actually moved.
 */
export const PREDICATE_MERGE_CYPHER = `
  MATCH (dup:Predicate {id: $dupId, userId: $userId})
  MATCH (keep:Predicate {id: $keepId, userId: $userId})
  SET keep.aliases = CASE
    WHEN dup.canonicalName IN keep.aliases THEN keep.aliases
    ELSE keep.aliases + dup.canonicalName
  END
  WITH dup, keep
  OPTIONAL MATCH (f:Fact {userId: $userId})-[r:PREDICATE]->(dup)
  DELETE r
  WITH dup, keep, count(f) AS moved
  SET keep.factCount = keep.factCount + moved
  DETACH DELETE dup
  RETURN moved
`;

/**
 * `(S, P, *)` facts that are still current — the dedupe check. Only current
 * facts may be superseded, which is why `isCurrent = true` is in the MATCH
 * rather than left to the caller.
 */
export const FACT_CURRENT_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})-[:SUBJECT]->(s {id: $subjectId})
  MATCH (f)-[:PREDICATE]->(p:Predicate {id: $predicateId})
  MATCH (f)-[:OBJECT]->(o)
  RETURN f.id AS id, o.id AS objectId
`;

export const FACT_CLOSE_CYPHER = `
  UNWIND $factIds AS factId
  MATCH (f:Fact {id: factId, userId: $userId})
  WHERE f.isCurrent = true
  SET f.isCurrent = false, f.validTo = $now
  RETURN count(f) AS closed
`;

export type FactEndLabel = "User" | "Entity" | "Value";

const FACT_END_LABELS: readonly FactEndLabel[] = ["User", "Entity", "Value"];

const ORPHAN_LABELS: readonly ("Entity" | "Predicate" | "Value")[] = [
  "Entity",
  "Predicate",
  "Value",
];

/**
 * Cypher cannot parameterise a label, so the two ends are interpolated — behind
 * an allow-list, because anything reaching this string is injection. The throw
 * is the guard: an unknown label is a bug, not a value.
 *
 * The tenant guard exempts `:User`, which carries no `userId` because it *is*
 * the user.
 */
export function buildFactCreateCypher(
  subjectLabel: FactEndLabel,
  objectLabel: FactEndLabel,
): string {
  if (
    !FACT_END_LABELS.includes(subjectLabel) ||
    !FACT_END_LABELS.includes(objectLabel)
  ) {
    throw new Error(
      `Unsupported fact end label: ${subjectLabel}/${objectLabel}`,
    );
  }

  return `
    MATCH (s:${subjectLabel} {id: $subjectId})
    MATCH (o:${objectLabel} {id: $objectId})
    MATCH (p:Predicate {id: $predicateId, userId: $userId})
    WHERE (s:User OR s.userId = $userId)
      AND (o:User OR o.userId = $userId)
    CREATE (f:Fact {
      id: $id, userId: $userId, embedding: $embedding, isCurrent: true,
      validFrom: $now, validTo: null, confidence: $confidence,
      sourceText: $sourceText, createdAt: $now
    })
    CREATE (f)-[:SUBJECT]->(s)
    CREATE (f)-[:PREDICATE]->(p)
    CREATE (f)-[:OBJECT]->(o)
    SET p.factCount = p.factCount + 1
  `;
}

/**
 * Orphan collection, one statement per label so each can use its own
 * `(userId)` index.
 *
 * `ABOUT` is in the pattern on purpose: the graph view reads `:Memory` entities,
 * so a GC that ignored an `ABOUT` edge would delete what the view draws.
 */
export function buildOrphanGcCypher(label: "Entity" | "Predicate" | "Value"): string {
  if (!ORPHAN_LABELS.includes(label)) {
    throw new Error(`Unsupported orphan label: ${label}`);
  }
  return `
    MATCH (n:${label} {userId: $userId})
    WHERE NOT ()-[:SUBJECT|OBJECT|PREDICATE|ABOUT]->(n)
    DETACH DELETE n
  `;
}

/**
 * The recall seed over facts.
 *
 * The `WHERE` sits inside `SEARCH` because that is the grammar a Neo4j vector
 * search accepts for a filter — equality and `AND` only. A post-filter would let
 * a closed or foreign fact rank high and consume one of the k slots.
 */
export const FACT_SEED_CYPHER = `
  MATCH (f:Fact)
    SEARCH f IN (
      VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.fact}
      FOR $queryVector
      WHERE f.userId = $userId AND f.isCurrent = true
      LIMIT $k
    ) SCORE AS vectorScore
  RETURN f.id AS id, f.sourceText AS sourceText, f.createdAt AS createdAt,
         vectorScore
`;

/** The pending-capture arm: a sentence saved a second ago is already recallable. */
export const CAPTURE_SEED_CYPHER = `
  MATCH (c:Capture)
    SEARCH c IN (
      VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.capture}
      FOR $queryVector
      WHERE c.userId = $userId
      LIMIT $k
    ) SCORE AS vectorScore
  RETURN c.id AS id, c.text AS text, c.createdAt AS createdAt, vectorScore
`;

/**
 * Facts reachable from the seeds through shared subjects and objects —
 * `SUBJECT|OBJECT` only, so a `:Predicate` is never an intermediate, and `:User`
 * is excluded outright because every personal fact hangs off it and
 * fact->user->fact would reach the entire corpus.
 *
 * One hop lands on an entity, so the `(n:Fact)` filter leaves the two-hop
 * fact->entity->fact paths, which is what makes `MEMORY_RECALL_HOPS = 2` the
 * right bound.
 */
export const FACT_EXPAND_CYPHER = `
  MATCH path = (seed:Fact)-[:SUBJECT|OBJECT*1..${MEMORY_RECALL_HOPS}]-(n:Fact)
  WHERE seed.id IN $seedIds
    AND n.userId = $userId
    AND n.isCurrent = true
    AND NOT any(x IN nodes(path) WHERE x:User)
    AND all(x IN nodes(path) WHERE x.userId = $userId)
  RETURN n.id AS id, n.sourceText AS sourceText, n.createdAt AS createdAt,
         length(path) AS hops,
         reduce(w = 1.0, r IN relationships(path) | w * coalesce(r.weight, 1.0)) AS pathWeight
  ORDER BY pathWeight DESC
  LIMIT toInteger($expansionLimit)
`;

/**
 * The most recent closed fact per recalled fact, matched on the *shared subject
 * and predicate* rather than on text similarity — the supersede rule is
 * structural, so its history is too. Ordered so the caller can take the first
 * row per fact and drop the rest, bounding history to one predecessor.
 *
 * The `<-[:PREDICATE]-(old)` arm shares the seed's `:Predicate` node, which is
 * what makes "same subject, same predicate" an identity test rather than a
 * similarity one.
 */
export const FACT_PREDECESSOR_CYPHER = `
  UNWIND $factIds AS factId
  MATCH (f:Fact {id: factId, userId: $userId})-[:SUBJECT]->(s)
  MATCH (f)-[:PREDICATE]->(p:Predicate)<-[:PREDICATE]-(old)
  MATCH (old:Fact {userId: $userId, isCurrent: false})-[:SUBJECT]->(s)
  WHERE old.validTo IS NOT NULL
  RETURN f.id AS factId, old.sourceText AS sourceText, old.validTo AS validTo
  ORDER BY old.validTo DESC
`;

/** The paginated listing, newest first. */
export const FACT_LIST_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})
  RETURN f.id AS id, f.sourceText AS text, f.createdAt AS createdAt
  ORDER BY f.createdAt DESC
  LIMIT toInteger($limit) OFFSET toInteger($offset)
`;

export const FACT_COUNT_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})
  RETURN count(f) AS total
`;

/** One fact by id, for the detail route. */
export const FACT_GET_CYPHER = `
  MATCH (f:Fact {id: $id, userId: $userId})
  RETURN f.id AS id, f.sourceText AS sourceText, f.createdAt AS createdAt
`;

/**
 * The one real delete in the design — everything else closes. DETACH, so the
 * fact's three edges go with it; the orphan GC then collects any entity,
 * predicate or value left with nothing pointing at it.
 */
export const FACT_DELETE_CYPHER = `
  MATCH (f:Fact {id: $id, userId: $userId}) DETACH DELETE f
`;

/** Vectorless facts from an embedding outage, waiting for the sweep to fill them. */
export const FACT_VECTORLESS_CYPHER = `
  MATCH (f:Fact {userId: $userId})
  WHERE f.embedding IS NULL
  RETURN f.id AS id, f.sourceText AS sourceText
  LIMIT toInteger($limit)
`;

export const FACT_EMBEDDING_CYPHER = `
  MATCH (f:Fact {id: $id, userId: $userId})
  SET f.embedding = $embedding
`;

/**
 * The reconciliation candidate set: current facts under a functional predicate.
 * Grouping and the keep-the-newest decision happen in TypeScript
 * (`selectSuperseded`), because "which of these is stale" is exactly the kind of
 * call worth a unit test rather than a Cypher assertion.
 */
export const FACT_RECONCILE_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})-[:SUBJECT]->(s)
  MATCH (f)-[:PREDICATE]->(p:Predicate {userId: $userId})
  WHERE p.canonicalName IN $predicates
  RETURN f.id AS id, f.createdAt AS createdAt,
         s.id AS subjectId, p.id AS predicateId
  ORDER BY f.createdAt ASC
  LIMIT toInteger($limit)
`;
