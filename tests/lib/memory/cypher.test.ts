import { describe, expect, it } from "vitest";
import {
  ENTITY_NEAREST_SQL,
  ENRICH_PENDING_SQL,
  MEMORY_EMBEDDING_SQL,
  buildMemoryEdgeSql,
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
describe("buildMemoryEdgeSql", () => {
  it("emits each permitted edge type as the relationship type", () => {
    // Drift guard: adding a type to MEMORY_LLM_EDGE_TYPES without teaching the
    // store to write it fails here rather than silently at the graph.
    for (const type of MEMORY_LLM_EDGE_TYPES) {
      expect(buildMemoryEdgeSql(type)).toContain(`[r:${type}]`);
    }
  });

  it("refuses a type outside the allow-list rather than interpolating it", () => {
    // The type is interpolated because Cypher cannot parameterise a
    // relationship type. That makes this guard the only thing between an
    // allow-list and string injection into a statement. Matched on the message
    // so a missing export cannot pass this by throwing a TypeError instead.
    expect(() => buildMemoryEdgeSql("ABOUT" as never)).toThrow(
      /not a permitted memory edge type/,
    );
    expect(() => buildMemoryEdgeSql("nope" as never)).toThrow(
      /not a permitted memory edge type/,
    );
  });

  it("scopes the edge target to the same user, which is what drops a foreign id", () => {
    expect(buildMemoryEdgeSql("RELATES_TO")).toContain(
      "other:Memory {id: edge.targetId, userId: $userId}",
    );
  });
});

describe("ENTITY_NEAREST_SQL", () => {
  it("resolves near-duplicates in-index, filtered by userId", () => {
    // Same invariant SEED_SQL carries: a post-filter would let one tenant's
    // entities crowd out another's, and the entity index is the one place
    // enrichment can reach across users if this regresses.
    expect(ENTITY_NEAREST_SQL).toContain(
      `VECTOR INDEX ${MEMORY_VECTOR_INDEX_NAMES.entity}`,
    );
    expect(ENTITY_NEAREST_SQL).toContain("WHERE e.userId = $userId");
    expect(ENTITY_NEAREST_SQL).toContain("score >= $threshold");
  });
});

describe("ENRICH_PENDING_SQL", () => {
  it("selects a memory missing either its enrichment or its embedding", () => {
    // One command, two recovery paths — the spec's whole reason for the sweep.
    expect(ENRICH_PENDING_SQL).toContain("m.enrichedAt IS NULL");
    expect(ENRICH_PENDING_SQL).toContain("m.embedding IS NULL");
  });

  it("coerces its limit, because the driver sends a plain number as a Float", () => {
    expect(ENRICH_PENDING_SQL).toContain("LIMIT toInteger($limit)");
  });

  it("reports which of the two recoveries the memory needs", () => {
    // Without this the sweep cannot tell an already-embedded memory from a
    // vectorless one, and the `embedding IS NULL` arm it selects on is one it
    // never satisfies — so every run re-enriches the same memories at a model
    // call each.
    expect(ENRICH_PENDING_SQL).toContain("m.embedding IS NULL AS vectorless");
  });
});

describe("MEMORY_EMBEDDING_SQL", () => {
  it("backfills the vector on the caller's own memory only", () => {
    expect(MEMORY_EMBEDDING_SQL).toContain(
      "MATCH (m:Memory {id: $id, userId: $userId})",
    );
    expect(MEMORY_EMBEDDING_SQL).toContain("SET m.embedding = $embedding");
  });
});
