import { describe, expect, it } from "vitest";
import { MEMORY_EDGE_NEIGHBOR_LIMIT } from "@/constants/memory";
import {
  buildDeterministicEdges,
  entityMergeKey,
  extractEntityNames,
  normalizeEntityName,
  relationScore,
} from "@/lib/memory/extract";

describe("normalizeEntityName", () => {
  it("lowercases and trims", () => {
    expect(normalizeEntityName("  Acme Corp  ")).toBe("acme corp");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeEntityName("Acme   \n  Corp")).toBe("acme corp");
  });

  it("strips a possessive", () => {
    expect(normalizeEntityName("Acme's")).toBe("acme");
    expect(normalizeEntityName("Acme’s")).toBe("acme");
  });

  it("strips surrounding punctuation", () => {
    expect(normalizeEntityName("(Acme),")).toBe("acme");
    expect(normalizeEntityName('"Acme!"')).toBe("acme");
  });

  it("returns an empty string for input with no letters or digits", () => {
    // The empty name must never reach a MERGE: one (:Entity {normalizedName: ""})
    // would be shared by every user and bridge their graphs.
    expect(normalizeEntityName("()")).toBe("");
    expect(normalizeEntityName("'s")).toBe("");
    expect(normalizeEntityName("   ")).toBe("");
    expect(normalizeEntityName("")).toBe("");
  });
});

describe("entityMergeKey", () => {
  it("scopes the key to the user, so two users' Acme are two nodes", () => {
    expect(entityMergeKey("user-a", "acme")).not.toBe(
      entityMergeKey("user-b", "acme"),
    );
  });

  it("is stable for the same user and name", () => {
    expect(entityMergeKey("user-a", "acme")).toBe(entityMergeKey("user-a", "acme"));
  });
});

describe("extractEntityNames", () => {
  it("finds capitalized proper nouns", () => {
    expect(extractEntityNames("I work at Acme Corp in Bengaluru")).toEqual(
      expect.arrayContaining(["acme corp", "bengaluru"]),
    );
  });

  it("returns nothing for empty content", () => {
    expect(extractEntityNames("")).toEqual([]);
    expect(extractEntityNames("   ")).toEqual([]);
  });

  it("returns nothing for content with no significant tokens", () => {
    expect(extractEntityNames("the and of a")).toEqual([]);
  });

  it("returns nothing for content that is only punctuation", () => {
    expect(extractEntityNames("!!! *** ???")).toEqual([]);
  });

  it("never returns an empty name", () => {
    for (const name of extractEntityNames("Acme's (Bengaluru) ... !!")) {
      expect(name).not.toBe("");
    }
  });

  it("deduplicates", () => {
    const names = extractEntityNames("Acme Acme ACME");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("relationScore", () => {
  it("is 0 for two empty strings", () => {
    expect(relationScore({ content: "" }, { content: "" })).toBe(0);
  });

  it("is higher for content that shares vocabulary", () => {
    const related = relationScore(
      { content: "I deploy on Fridays" },
      { content: "my deploy window is Friday" },
    );
    const unrelated = relationScore(
      { content: "I deploy on Fridays" },
      { content: "the cat is asleep" },
    );
    expect(related).toBeGreaterThan(unrelated);
  });

  it("never exceeds 1", () => {
    const same = { content: "alpha beta gamma" };
    expect(relationScore(same, same)).toBeLessThanOrEqual(1);
  });

  it("gives recency no weight when nothing else matches", () => {
    // :605 returns 0 before it reaches the recency term. Without that guard two
    // unrelated memories written a day apart would be linked by the clock alone.
    expect(
      relationScore(
        { content: "deploy window is friday", createdAt: "2026-01-01T00:00:00.000Z" },
        { content: "cat asleep on mat", createdAt: "2026-01-02T00:00:00.000Z" },
      ),
    ).toBe(0);
  });

  it("adds recency weight once the pair is already related", () => {
    const left = { content: "deploy window is friday", createdAt: "2026-01-05T00:00:00.000Z" };
    const near = { content: "deploy window is monday", createdAt: "2026-01-10T00:00:00.000Z" };
    const far = { content: "deploy window is monday", createdAt: "2025-01-10T00:00:00.000Z" };
    expect(relationScore(left, near)).toBeGreaterThan(relationScore(left, far));
  });
});

describe("buildDeterministicEdges", () => {
  const memory = { id: "m1", content: "I deploy on Fridays" };
  const related = { id: "m2", content: "my deploy window is Friday" };
  const unrelated = { id: "m3", content: "the cat is asleep on the mat" };

  it("links a related memory", () => {
    const edges = buildDeterministicEdges(memory, [related, unrelated]);
    expect(edges.map((e) => e.id)).toContain("m2");
  });

  it("drops an unrelated memory below the threshold", () => {
    const edges = buildDeterministicEdges(memory, [unrelated]);
    expect(edges.map((e) => e.id)).not.toContain("m3");
  });

  it("never links a memory to itself", () => {
    const edges = buildDeterministicEdges(memory, [memory, related]);
    expect(edges.map((e) => e.id)).not.toContain("m1");
  });

  it("caps the neighbour count, highest score first", () => {
    const others = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i + 10}`,
      content: "I deploy on Fridays in the deploy window",
    }));
    const edges = buildDeterministicEdges(memory, others);
    expect(edges.length).toBeLessThanOrEqual(MEMORY_EDGE_NEIGHBOR_LIMIT);
    const scores = edges.map((e) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns nothing when there is nothing to compare against", () => {
    expect(buildDeterministicEdges(memory, [])).toEqual([]);
  });

  it("returns nothing for a memory with empty content", () => {
    expect(
      buildDeterministicEdges({ id: "m0", content: "" }, [related]),
    ).toEqual([]);
  });
});
