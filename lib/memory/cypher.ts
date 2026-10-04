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
  MEMORY_RECALL_HOPS,
  MEMORY_VECTOR_INDEX_NAMES,
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
 *
 * Read/write clauses are order-sensitive and Neo4j reports a wrong order as a
 * *syntax* error, not a plan one: a paging statement must read
 * `ORDER BY … OFFSET … LIMIT …`, with `LIMIT` last. A statement no check script
 * executes is a statement whose syntax nothing has verified — which is how
 * `FACT_LIST_CYPHER` reached a running dev server broken.
 */

// Cypher does not accept a parameter for a variable-length bound — `*1..$hops`
// is a syntax error, verified against the live server. `FACT_EXPAND_CYPHER`
// interpolates the bound, which is only safe because it is a literal constant;
// the guard below is what keeps that true if the constant is ever changed.
if (!Number.isInteger(MEMORY_RECALL_HOPS) || MEMORY_RECALL_HOPS < 1) {
  throw new Error(`MEMORY_RECALL_HOPS must be a positive integer, got ${MEMORY_RECALL_HOPS}`);
}

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

/**
 * How much of the user's work is still outstanding, for the list's poll.
 *
 * Bounded by `attempts` for the same reason the worklist is: a capture whose
 * extraction has been spent is no longer pending, and a signal that counted it
 * would keep the tab polling for work that will never run.
 */
export const CAPTURE_PENDING_COUNT_CYPHER = `
  MATCH (c:Capture {userId: $userId})
  WHERE c.attempts < $maxAttempts
  RETURN count(c) AS pending
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
 * enough to be the same thing. In-index filtered — a post-filter would score
 * every tenant's entities against each other — and
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
 * `OPTIONAL MATCH` and `collect` rather than a plain `MATCH`, because a
 * predicate with no facts must still merge — a plain MATCH would leave the loser
 * behind forever — and because `CREATE` cannot take the null `f` that an
 * optional match with no rows produces. `collect` drops nulls, so `size` counts
 * exactly the facts moved and the factCount bump matches the edges created.
 *
 * The rewiring is a `CREATE` of a new edge to the survivor followed by the
 * `DELETE` of the old one. Nothing here may simply delete: a fact whose
 * `PREDICATE` edge is gone still exists, but it has no predicate, so it stops
 * being findable by `FACT_CURRENT_CYPHER`, stops seeding under its own
 * predicate, and is invisible to the reconciliation sweep.
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
  WITH dup, keep, collect(f) AS movedFacts
  FOREACH (fact IN movedFacts | CREATE (fact)-[:PREDICATE]->(keep))
  WITH dup, keep, size(movedFacts) AS moved
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
 * search accepts for a filter — equality and `AND` only; a `<>`, an `OR` or a
 * string operator there fails with error 22ND3. Keeping it in-index is what
 * makes the search keep scanning until it has $k *matching* rows: a post-filter
 * would let a closed or foreign fact rank high and consume one of the k slots.
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
  OFFSET toInteger($offset) LIMIT toInteger($limit)
`;

export const FACT_COUNT_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})
  RETURN count(f) AS total
`;

/**
 * The graph view's read: the newest current facts, each with its three satellite
 * endpoints flattened into one row. The bulk form of `FACT_EDGES_CYPHER`, made
 * label-aware so the assembler can tell an `:Entity` object from a `:Value` one
 * — `coalesce(o.name, o.text)` is what lets both land in one column.
 *
 * `toInteger($limit)` is mandatory: every plain JS number is packed as a
 * Float64, and a bare `LIMIT $limit` raises `22003: '30.0' is not a valid
 * value`. `WITH … ORDER BY … LIMIT` is the only clause order Neo4j accepts —
 * a wrong one is a *syntax* error, which neither the type-check nor a unit test
 * would ever see.
 *
 * The window is decided here, newest first, and `FACT_COUNT_CYPHER` supplies the
 * true total beside it: truncation cannot be inferred from "the read returned
 * exactly the limit", which would report it for a user who has exactly that many.
 */
export const GRAPH_FACTS_CYPHER = `
  MATCH (f:Fact {userId: $userId, isCurrent: true})
  WITH f ORDER BY f.createdAt DESC LIMIT toInteger($limit)
  OPTIONAL MATCH (f)-[:SUBJECT]->(s)
  OPTIONAL MATCH (f)-[:PREDICATE]->(p:Predicate)
  OPTIONAL MATCH (f)-[:OBJECT]->(o)
  RETURN f.id AS factId, f.sourceText AS text, f.createdAt AS createdAt,
         s.id AS subjectId, labels(s)[0] AS subjectKind, s.name AS subjectName,
         p.id AS predicateId, p.canonicalName AS predicateName,
         o.id AS objectId, labels(o)[0] AS objectKind,
         coalesce(o.name, o.text) AS objectName
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

/**
 * Users with outstanding work: a capture not yet extracted, or a fact with no
 * vector. Both are cheap index reads, so the union is too.
 */
export const SWEEP_WORKLIST_CYPHER = `
  MATCH (n)
  WHERE (n:Capture AND n.attempts < $maxAttempts) OR (n:Fact AND n.embedding IS NULL)
  RETURN DISTINCT n.userId AS userId
  LIMIT toInteger($limit)
`;

export const CAPTURE_COUNT_CYPHER = `
  MATCH (c:Capture {userId: $userId}) RETURN count(c) AS total
`;

export const FACT_COUNT_ALL_CYPHER = `
  MATCH (f:Fact {userId: $userId})
  RETURN count(f) AS total,
         count(CASE WHEN f.isCurrent THEN 1 END) AS current
`;

/** The check harness asserts on a clean slate, so it deletes what it made. */
export const TEST_GC_CYPHER = `
  MATCH (n {userId: $userId}) DETACH DELETE n
`;

export const PREDICATE_GET_CYPHER = `
  MATCH (p:Predicate {id: $id, userId: $userId})
  RETURN p.canonicalName AS canonicalName, p.aliases AS aliases,
         p.factCount AS factCount
`;

export const FACT_EDGES_CYPHER = `
  MATCH (f:Fact {id: $id, userId: $userId})
  OPTIONAL MATCH (f)-[:SUBJECT]->(s)
  OPTIONAL MATCH (f)-[:PREDICATE]->(p:Predicate)
  OPTIONAL MATCH (f)-[:OBJECT]->(o)
  RETURN s.id AS subjectId, p.id AS predicateId, o.id AS objectId
`;
