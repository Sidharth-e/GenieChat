import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_INDEX_NAMES,
  KNOWLEDGE_TABLE,
  buildKnowledgeDdl,
} from "@/constants/knowledge";

describe("buildKnowledgeDdl", () => {
  it("interpolates the embedding dimension into the vector column", () => {
    const ddl = buildKnowledgeDdl(768).join("\n");
    expect(ddl).toContain("embedding   vector(768)");
  });

  it("creates the vector extension before the table that uses it", () => {
    const ddl = buildKnowledgeDdl(768);
    expect(ddl[0]).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(ddl.indexOf(ddl[0])).toBeLessThan(
      ddl.findIndex((s) => s.includes("CREATE TABLE")),
    );
  });

  it("uses every declared index name exactly once", () => {
    const ddl = buildKnowledgeDdl(768).join("\n");
    for (const name of Object.values(KNOWLEDGE_INDEX_NAMES)) {
      expect(ddl.split(name).length - 1).toBe(1);
    }
  });

  it("builds a GIN index for full-text search and an HNSW index for vectors", () => {
    const ddl = buildKnowledgeDdl(768).join("\n");
    expect(ddl).toContain(`USING gin (content_tsv)`);
    expect(ddl).toContain(`USING hnsw (embedding vector_cosine_ops)`);
  });

  it("rejects a non-positive or fractional dimension", () => {
    expect(() => buildKnowledgeDdl(0)).toThrow(/Invalid embedding dimensions/);
    expect(() => buildKnowledgeDdl(1.5)).toThrow(/Invalid embedding dimensions/);
  });

  it("targets the table every other module reads", () => {
    expect(buildKnowledgeDdl(768)[1]).toContain(KNOWLEDGE_TABLE);
  });
});
