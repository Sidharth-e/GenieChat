import { describe, expect, it } from "vitest";
import {
  MEMORY_VECTOR_INDEX_NAMES,
  buildNeo4jDdl,
} from "@/constants/memory";

describe("buildNeo4jDdl", () => {
  it("interpolates the embedding dimension into both vector indexes", () => {
    const ddl = buildNeo4jDdl(768).join("\n");
    expect(ddl.split("`vector.dimensions`: 768").length - 1).toBe(2);
  });

  it("declares userId as a filterable property on both vector indexes", () => {
    // Without WITH [...], the SEARCH clause cannot filter in-index and
    // multi-tenant retrieval starves. This is the load-bearing line.
    const ddl = buildNeo4jDdl(768).join("\n");
    expect(ddl).toContain("WITH [m.userId]");
    expect(ddl).toContain("WITH [e.userId]");
  });

  it("uses cosine similarity", () => {
    const ddl = buildNeo4jDdl(768).join("\n");
    expect(ddl.split("`vector.similarity_function`: 'cosine'").length - 1).toBe(2);
  });

  it("keys entities by user and normalized name, so two users never share one", () => {
    expect(buildNeo4jDdl(768).join("\n")).toContain(
      "FOR (e:Entity) REQUIRE (e.userId, e.normalizedName) IS UNIQUE",
    );
  });

  it("indexes enrichedAt, which is the enrichment sweep's predicate", () => {
    expect(buildNeo4jDdl(768).join("\n")).toContain(
      "FOR (m:Memory) ON (m.enrichedAt)",
    );
  });

  it("indexes the edge-candidate window the write path orders by", () => {
    // `EDGE_CANDIDATE_CYPHER` is `MATCH (other:Memory {userId}) ... ORDER BY
    // other.createdAt DESC LIMIT 200`, and every create and content-changing
    // update runs it. `memory_user` on (userId) alone leaves Neo4j reading and
    // sorting the user's entire memory set before it can take the newest 200,
    // so the write cost the spec calls "proportional to this memory's entity
    // count, not to the corpus" was proportional to the corpus after all. The
    // composite index is what makes the ORDER BY an index-order read.
    expect(buildNeo4jDdl(768).join("\n")).toContain(
      "FOR (m:Memory) ON (m.userId, m.createdAt)",
    );
  });

  it("names every vector index exactly once", () => {
    const ddl = buildNeo4jDdl(768).join("\n");
    for (const name of Object.values(MEMORY_VECTOR_INDEX_NAMES)) {
      expect(ddl.split(name).length - 1).toBe(1);
    }
  });

  it("rejects a non-positive or fractional dimension", () => {
    expect(() => buildNeo4jDdl(0)).toThrow(/Invalid embedding dimensions/);
    expect(() => buildNeo4jDdl(1.5)).toThrow(/Invalid embedding dimensions/);
  });

  it("is idempotent by construction — every statement uses IF NOT EXISTS", () => {
    for (const statement of buildNeo4jDdl(768)) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });
});
