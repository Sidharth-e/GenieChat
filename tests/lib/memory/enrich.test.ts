import { describe, expect, it } from "vitest";
import { parseEnrichment } from "@/lib/memory/enrichment-schema";

const valid = {
  entities: [
    { name: "Acme Corp", type: "organization" },
    { name: "Bengaluru", type: "place" },
  ],
  relations: [{ from: "Acme Corp", to: "Bengaluru", type: "located_in" }],
  memoryEdges: [{ targetId: "m2", type: "CONTRADICTS", reason: "different day" }],
};

describe("parseEnrichment", () => {
  it("accepts a well-formed response", () => {
    const parsed = parseEnrichment(valid);
    expect(parsed?.entities).toHaveLength(2);
    expect(parsed?.memoryEdges?.[0].type).toBe("CONTRADICTS");
  });

  it("returns null rather than throwing on malformed input", () => {
    expect(parseEnrichment({ entities: "not an array" })).toBeNull();
    expect(parseEnrichment(null)).toBeNull();
    expect(parseEnrichment(undefined)).toBeNull();
    expect(parseEnrichment("a string")).toBeNull();
  });

  it("rejects an edge type outside the allow-list", () => {
    expect(
      parseEnrichment({
        ...valid,
        memoryEdges: [{ targetId: "m2", type: "CAUSES", reason: "x" }],
      }),
    ).toBeNull();
  });

  it("accepts each allowed memory edge type", () => {
    for (const type of ["RELATES_TO", "SUPERSEDES", "CONTRADICTS"]) {
      expect(
        parseEnrichment({ ...valid, memoryEdges: [{ targetId: "m2", type, reason: "x" }] }),
      ).not.toBeNull();
    }
  });

  it("drops an entity whose name normalizes to empty, keeping the rest", () => {
    // An empty normalizedName would MERGE one node shared by every user, so it
    // must never reach the store — but one bad name must not discard the whole
    // extraction. Note this is a *drop*, not a rejection: a bad shape returns
    // null, a bad name is skipped.
    const parsed = parseEnrichment({
      ...valid,
      entities: [
        { name: "'s", type: "other" },
        { name: "Acme Corp", type: "organization" },
      ],
      relations: [],
    });
    expect(parsed?.entities.map((e) => e.normalizedName)).toEqual(["acme corp"]);
  });

  it("never emits an entity with an empty normalized name", () => {
    const parsed = parseEnrichment({
      ...valid,
      entities: [{ name: "()", type: "other" }],
      relations: [],
    });
    expect(parsed?.entities).toEqual([]);
  });

  it("drops a relation naming an entity the response never defined", () => {
    const parsed = parseEnrichment({
      ...valid,
      relations: [{ from: "Acme Corp", to: "Nowhere At All", type: "located_in" }],
    });
    expect(parsed?.relations).toEqual([]);
  });

  it("accepts an empty extraction — a memory with nothing to say", () => {
    expect(parseEnrichment({ entities: [], relations: [], memoryEdges: [] })).toEqual({
      entities: [],
      relations: [],
      memoryEdges: [],
    });
  });

  it("defaults the optional collections when they are absent", () => {
    const parsed = parseEnrichment({ entities: [], relations: [] });
    expect(parsed?.memoryEdges).toEqual([]);
  });

  it("normalizes entity names on the way out", () => {
    const parsed = parseEnrichment({ entities: [{ name: "  Acme   Corp ", type: "org" }], relations: [] });
    expect(parsed?.entities[0].normalizedName).toBe("acme corp");
  });

  it("rejects a memory edge with no target id", () => {
    expect(
      parseEnrichment({ ...valid, memoryEdges: [{ type: "CONTRADICTS", reason: "x" }] }),
    ).toBeNull();
  });
});
