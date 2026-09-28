/**
 * The statements that define the memory graph's read, delete and garbage-collect
 * behaviour, kept out of `graph-store.ts` so that `scripts/check-memory.ts` can
 * execute the *same* SQL the store does.
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
 * `SEED_SQL` is the exception, and only because it does not need the coercion:
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
export const SEED_SQL = `
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
export const EXPAND_SQL = `
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
export const EDGE_CANDIDATE_SQL = `
  MATCH (other:Memory {userId: $userId})
  WHERE other.id <> $id
  RETURN other.id AS id, other.content AS content
  ORDER BY other.createdAt DESC
  LIMIT toInteger($limit)
`;

/** DETACH, so the memory's edges go with it. */
export const MEMORY_DELETE_SQL = `
  MATCH (m:Memory {id: $id, userId: $userId}) DETACH DELETE m
`;

/**
 * Without this, entities accumulate forever: a leak this design would otherwise
 * introduce. Scoped by userId, which is indexed.
 */
export const ENTITY_GC_SQL = `
  MATCH (e:Entity {userId: $userId})
  WHERE NOT (e)<-[:ABOUT]-(:Memory)
  DETACH DELETE e
`;
