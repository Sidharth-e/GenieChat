import { describe, expect, it } from "vitest";
import { MEMORY_VECTOR_INDEX_NAMES } from "@/constants/memory";
import {
  buildFactCreateCypher,
  buildOrphanGcCypher,
  CAPTURE_PENDING_CYPHER,
  CAPTURE_SEED_CYPHER,
  FACT_CLOSE_CYPHER,
  FACT_EXPAND_CYPHER,
  FACT_PREDECESSOR_CYPHER,
  FACT_SEED_CYPHER,
  PREDICATE_NEAREST_CYPHER,
} from "@/lib/memory/cypher";

describe("FACT_SEED_CYPHER", () => {
  it("filters tenant and currency inside SEARCH, where the index can see them", () => {
    const search = FACT_SEED_CYPHER.slice(
      FACT_SEED_CYPHER.indexOf("SEARCH"),
      FACT_SEED_CYPHER.indexOf("SCORE AS"),
    );
    expect(search).toContain("WHERE f.userId = $userId AND f.isCurrent = true");
  });

  it("uses the fact vector index", () => {
    expect(FACT_SEED_CYPHER).toContain(MEMORY_VECTOR_INDEX_NAMES.fact);
  });

  it("returns the sentence, not a rendered triple", () => {
    expect(FACT_SEED_CYPHER).toContain("f.sourceText AS sourceText");
  });
});

describe("CAPTURE_SEED_CYPHER", () => {
  it("uses the capture vector index and the tenant filter", () => {
    expect(CAPTURE_SEED_CYPHER).toContain(MEMORY_VECTOR_INDEX_NAMES.capture);
    expect(CAPTURE_SEED_CYPHER).toContain("WHERE c.userId = $userId");
  });
});

describe("FACT_EXPAND_CYPHER", () => {
  it("walks only SUBJECT and OBJECT, so a predicate node is never an intermediate", () => {
    expect(FACT_EXPAND_CYPHER).toContain("-[:SUBJECT|OBJECT*1..2]-");
  });

  it("refuses a path through the user anchor", () => {
    // Every personal fact hangs off the user, so fact->user->fact reaches the
    // whole corpus. The anchor is a namespace, not a router.
    expect(FACT_EXPAND_CYPHER).toContain("NOT any(x IN nodes(path) WHERE x:User)");
  });

  it("re-checks the tenant on every node of every hop", () => {
    expect(FACT_EXPAND_CYPHER).toContain(
      "all(x IN nodes(path) WHERE x.userId = $userId)",
    );
  });

  it("reaches only current facts", () => {
    expect(FACT_EXPAND_CYPHER).toContain("n.isCurrent = true");
  });

  it("coerces the limit, because a plain number crosses the wire as a Float", () => {
    expect(FACT_EXPAND_CYPHER).toContain("LIMIT toInteger($expansionLimit)");
  });
});

describe("FACT_PREDECESSOR_CYPHER", () => {
  it("matches on the shared subject and predicate, not on content", () => {
    expect(FACT_PREDECESSOR_CYPHER).toContain("(f)-[:PREDICATE]->(p:Predicate)<-[:PREDICATE]-(old)");
  });

  it("takes only closed facts", () => {
    expect(FACT_PREDECESSOR_CYPHER).toContain("isCurrent: false");
    expect(FACT_PREDECESSOR_CYPHER).toContain("old.validTo IS NOT NULL");
  });

  it("orders so the newest predecessor is first", () => {
    expect(FACT_PREDECESSOR_CYPHER).toContain("ORDER BY old.validTo DESC");
  });
});

describe("FACT_CLOSE_CYPHER", () => {
  it("closes rather than deletes, and stamps both markers together", () => {
    expect(FACT_CLOSE_CYPHER).toContain("SET f.isCurrent = false, f.validTo = $now");
    expect(FACT_CLOSE_CYPHER).not.toContain("DELETE");
  });

  it("never re-closes an already-closed fact", () => {
    expect(FACT_CLOSE_CYPHER).toContain("WHERE f.isCurrent = true");
  });
});

describe("CAPTURE_PENDING_CYPHER", () => {
  it("bounds attempts, so a permanently unenrichable capture stops costing a call", () => {
    expect(CAPTURE_PENDING_CYPHER).toContain("c.attempts < $maxAttempts");
  });

  it("is oldest-first and coerces its limit", () => {
    expect(CAPTURE_PENDING_CYPHER).toContain("ORDER BY c.createdAt ASC");
    expect(CAPTURE_PENDING_CYPHER).toContain("LIMIT toInteger($limit)");
  });
});

describe("PREDICATE_NEAREST_CYPHER", () => {
  it("searches in-index rather than post-filtering the tenant", () => {
    const search = PREDICATE_NEAREST_CYPHER.slice(
      PREDICATE_NEAREST_CYPHER.indexOf("SEARCH"),
      PREDICATE_NEAREST_CYPHER.indexOf("SCORE AS"),
    );
    expect(search).toContain("WHERE p.userId = $userId");
    expect(PREDICATE_NEAREST_CYPHER).toContain(MEMORY_VECTOR_INDEX_NAMES.predicate);
  });
});

describe("buildFactCreateCypher", () => {
  it("labels both ends so a unique-id index can serve the match", () => {
    const cypher = buildFactCreateCypher("Entity", "Entity");
    expect(cypher).toContain("MATCH (s:Entity {id: $subjectId})");
    expect(cypher).toContain("MATCH (o:Entity {id: $objectId})");
  });

  it("keeps the tenant guard on both ends, exempting only the anchor", () => {
    const cypher = buildFactCreateCypher("Entity", "Value");
    expect(cypher).toContain("(s:User OR s.userId = $userId)");
    expect(cypher).toContain("(o:User OR o.userId = $userId)");
  });

  it("refuses a label outside the allow-list rather than interpolating it", () => {
    // Cypher cannot parameterise a label, so anything reaching the string is
    // injection; the allow-list is the only thing standing between the two.
    expect(() =>
      buildFactCreateCypher("Entity", "Memory" as never),
    ).toThrow(/Unsupported fact end label/);
  });

  it("creates the three edges and the current marker", () => {
    const cypher = buildFactCreateCypher("User", "Entity");
    expect(cypher).toContain("CREATE (f)-[:SUBJECT]->(s)");
    expect(cypher).toContain("CREATE (f)-[:PREDICATE]->(p)");
    expect(cypher).toContain("CREATE (f)-[:OBJECT]->(o)");
    expect(cypher).toContain("isCurrent: true");
  });
});

describe("buildOrphanGcCypher", () => {
  it("spares anything a :Memory node still points at", () => {
    // The graph view reads :Memory -> :Entity, so the GC must treat ABOUT as a
    // live reference or it will delete what the view draws.
    expect(buildOrphanGcCypher("Entity")).toContain("[:SUBJECT|OBJECT|PREDICATE|ABOUT]");
  });

  it("refuses a label outside the allow-list", () => {
    expect(() => buildOrphanGcCypher("User" as never)).toThrow(
      /Unsupported orphan label/,
    );
  });

  it("scopes the sweep to one user", () => {
    expect(buildOrphanGcCypher("Value")).toContain("{userId: $userId}");
  });
});
