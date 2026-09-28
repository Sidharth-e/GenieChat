import { describe, expect, it } from "vitest";
import {
  ENTITY_ABOUT_CYPHER,
  ENTITY_NEAREST_CYPHER,
  ENRICH_PENDING_CYPHER,
  MEMORY_EMBEDDING_CYPHER,
  MIGRATE_MEMORY_CYPHER,
  buildMemoryEdgeCypher,
} from "@/lib/memory/cypher";
import {
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_VECTOR_INDEX_NAMES,
} from "@/constants/memory";

/**
 * These assert on statement text, which is only worth doing where the text *is*
 * the contract. Three of the six guard a trap this project has already paid for
 * once each: the interpolated relationship type, the Float64 `LIMIT`, and the
 * in-index tenant filter.
 */
describe("buildMemoryEdgeCypher", () => {
  it("emits each permitted edge type as the relationship type", () => {
    // Drift guard: adding a type to MEMORY_LLM_EDGE_TYPES without teaching the
    // store to write it fails here rather than silently at the graph.
    for (const type of MEMORY_LLM_EDGE_TYPES) {
      expect(buildMemoryEdgeCypher(type)).toContain(`[r:${type}]`);
    }
  });

  it("refuses a type outside the allow-list rather than interpolating it", () => {
    // The type is interpolated because Cypher cannot parameterise a
    // relationship type. That makes this guard the only thing between an
    // allow-list and string injection into a statement. Matched on the message
    // so a missing export cannot pass this by throwing a TypeError instead.
    expect(() => buildMemoryEdgeCypher("ABOUT" as never)).toThrow(
      /not a permitted memory edge type/,
    );
    expect(() => buildMemoryEdgeCypher("nope" as never)).toThrow(
      /not a permitted memory edge type/,
    );
  });

  it("scopes the edge target to the same user, which is what drops a foreign id", () => {
    expect(buildMemoryEdgeCypher("RELATES_TO")).toContain(
      "other:Memory {id: edge.targetId, userId: $userId}",
    );
  });
});

describe("ENTITY_NEAREST_CYPHER", () => {
  it("resolves near-duplicates in-index, filtered by userId", () => {
    // Same invariant SEED_CYPHER carries: a post-filter would let one tenant's
    // entities crowd out another's, and the entity index is the one place
    // enrichment can reach across users if this regresses.
    expect(ENTITY_NEAREST_CYPHER).toContain(
      `VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.entity}`,
    );
    expect(ENTITY_NEAREST_CYPHER).toContain("WHERE e.userId = $userId");
    expect(ENTITY_NEAREST_CYPHER).toContain("score >= $threshold");
  });
});

describe("ENRICH_PENDING_CYPHER", () => {
  it("selects a memory missing either its enrichment or its embedding", () => {
    // One command, two recovery paths — the spec's whole reason for the sweep.
    expect(ENRICH_PENDING_CYPHER).toContain("m.enrichedAt IS NULL");
    expect(ENRICH_PENDING_CYPHER).toContain("m.embedding IS NULL");
  });

  it("coerces its limit, because the driver sends a plain number as a Float", () => {
    expect(ENRICH_PENDING_CYPHER).toContain("LIMIT toInteger($limit)");
  });

  it("reports which of the two recoveries the memory needs", () => {
    // Without this the sweep cannot tell an already-embedded memory from a
    // vectorless one, and the `embedding IS NULL` arm it selects on is one it
    // never satisfies — so every run re-enriches the same memories at a model
    // call each.
    expect(ENRICH_PENDING_CYPHER).toContain("m.embedding IS NULL AS vectorless");
  });
});

describe("MEMORY_EMBEDDING_CYPHER", () => {
  it("backfills the vector on the caller's own memory only", () => {
    expect(MEMORY_EMBEDDING_CYPHER).toContain(
      "MATCH (m:Memory {id: $id, userId: $userId})",
    );
    expect(MEMORY_EMBEDDING_CYPHER).toContain("SET m.embedding = $embedding");
  });
});

describe("ENTITY_ABOUT_CYPHER", () => {
  it("refills an entity's vector when a later write names it and has one", () => {
    // An entity first created while the embedder was down is written with a
    // null embedding. `ON CREATE SET` alone would leave it null forever — a
    // later write naming the same entity MERGEs onto the existing node and
    // the clause never fires again — and the in-index `ENTITY_NEAREST_CYPHER`
    // could never match it, so entity resolution would be off for that name
    // permanently and silently. `coalesce` fills the gap without overwriting a
    // vector that is already there.
    expect(ENTITY_ABOUT_CYPHER).toContain(
      "ON MATCH SET e.embedding = coalesce(e.embedding, $embedding)",
    );
  });
});

describe("MIGRATE_MEMORY_CYPHER", () => {
  it("clears enrichedAt only when it creates the memory", () => {
    // The migration is documented as safe to re-run. It is, for the nodes —
    // `MERGE` on the id constraint rewrites them rather than duplicating. But
    // a bare `SET m.enrichedAt = null` re-opens the *whole* corpus to the
    // enrichment sweep on every run, at one model call per memory, which is
    // not what "safe to re-run" promises an operator. Scoped to creation, a
    // migrated memory keeps whatever enrichment it has already had.
    expect(MIGRATE_MEMORY_CYPHER).toMatch(
      /MERGE \(m:Memory \{id: \$id\}\)[\s\S]*ON CREATE SET[\s\S]*m\.enrichedAt = null/,
    );
    expect(MIGRATE_MEMORY_CYPHER.split("m.enrichedAt = null").length - 1).toBe(1);
  });
});
