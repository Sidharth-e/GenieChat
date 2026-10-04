import { describe, expect, it } from "vitest";
import {
  buildNeo4jDdl,
  MEMORY_CONSTRAINT_NAMES,
  MEMORY_VECTOR_INDEX_NAMES,
} from "@/constants/memory";

const ddl = buildNeo4jDdl(2048);

describe("buildNeo4jDdl", () => {
  it("rejects a non-integer or non-positive dimension", () => {
    expect(() => buildNeo4jDdl(0)).toThrow();
    expect(() => buildNeo4jDdl(-8)).toThrow();
    expect(() => buildNeo4jDdl(1.5)).toThrow();
  });

  it("makes every statement idempotent", () => {
    for (const statement of ddl) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });

  it("keys entities and predicates by their resolution key, scoped to the user", () => {
    expect(ddl.join("\n")).toContain(
      "FOR (e:Entity) REQUIRE (e.userId, e.normalizedName) IS UNIQUE",
    );
    expect(ddl.join("\n")).toContain(
      "FOR (p:Predicate) REQUIRE (p.userId, p.canonicalName) IS UNIQUE",
    );
  });

  it("declares one vector index per seeded label, all filterable by userId", () => {
    for (const name of Object.values(MEMORY_VECTOR_INDEX_NAMES)) {
      expect(ddl.join("\n")).toContain(`CREATE VECTOR INDEX ${name} IF NOT EXISTS`);
    }
    // The fact index is the exception and is pinned by its own test below: it
    // declares `isCurrent` as well, because the seed filters on it in-index.
    expect(ddl.join("\n")).toContain("WITH [e.userId]");
    expect(ddl.join("\n")).toContain("WITH [p.userId]");
    expect(ddl.join("\n")).toContain("WITH [c.userId]");
  });

  it("indexes the current-only fact filter, because the seed's WHERE cannot test validTo", () => {
    expect(ddl.join("\n")).toContain(
      "CREATE INDEX fact_user_current IF NOT EXISTS\n       FOR (f:Fact) ON (f.userId, f.isCurrent)",
    );
  });

  it("makes isCurrent filterable in the fact vector index, not only in its options", () => {
    // A property is filterable *in a vector index* only when the index declares
    // it. The seed's in-index WHERE tests `isCurrent` alongside `userId`, so
    // declaring `userId` alone puts the index's own filter outside what the
    // index can answer -- Neo4j rejects the query with 22ND3 rather than
    // scanning, and the whole recall path fails on the first call.
    expect(ddl.join("\n")).toContain("WITH [f.userId, f.isCurrent]");
  });

  it("does not create anything for the retired :Memory label", () => {
    expect(ddl.join("\n")).not.toContain(":Memory");
  });

  it("names every constraint it creates", () => {
    for (const name of Object.values(MEMORY_CONSTRAINT_NAMES)) {
      expect(ddl.join("\n")).toContain(`CREATE CONSTRAINT ${name} IF NOT EXISTS`);
    }
  });
});
