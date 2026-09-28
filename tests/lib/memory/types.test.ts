import { describe, expect, it } from "vitest";
import {
  MEMORY_EDGE_NEIGHBOR_LIMIT,
  MEMORY_EDGE_THRESHOLD,
  MEMORY_ENTITY_MERGE_THRESHOLD,
  MEMORY_MAX_CONCEPT_FEATURES,
  MEMORY_MIN_TOKEN_LENGTH,
  MEMORY_RECALL_HOPS,
  MEMORY_RELATION_TYPES,
  MEMORY_SEED_MIN,
  MEMORY_SEED_MULTIPLIER,
  MEMORY_STOPWORDS,
  MEMORY_TRAVERSAL_DECAY,
  MEMORY_WEIGHT_GRAPH,
  MEMORY_WEIGHT_SEED,
  memorySeedLimit,
} from "@/constants/memory";

describe("memory tuning constants", () => {
  it("carries the existing graph tuning forward unchanged", () => {
    expect(MEMORY_EDGE_THRESHOLD).toBe(0.2);
    expect(MEMORY_EDGE_NEIGHBOR_LIMIT).toBe(12);
    expect(MEMORY_SEED_MULTIPLIER).toBe(3);
    expect(MEMORY_MIN_TOKEN_LENGTH).toBe(3);
    expect(MEMORY_MAX_CONCEPT_FEATURES).toBe(24);
  });

  it("bounds traversal at two hops, matching today's behaviour", () => {
    expect(MEMORY_RECALL_HOPS).toBe(2);
  });

  it("decays by less than one per hop, so a second hop still contributes", () => {
    expect(MEMORY_TRAVERSAL_DECAY).toBeGreaterThan(0);
    expect(MEMORY_TRAVERSAL_DECAY).toBeLessThan(1);
  });

  it("keeps the merge threshold high, so only near-duplicates collapse", () => {
    expect(MEMORY_ENTITY_MERGE_THRESHOLD).toBe(0.9);
  });

  it("allows exactly the four relationship types the design writes", () => {
    expect([...MEMORY_RELATION_TYPES].sort()).toEqual([
      "ABOUT",
      "CONTRADICTS",
      "RELATES_TO",
      "SUPERSEDES",
    ]);
  });

  it("has a non-empty stopword set", () => {
    expect(MEMORY_STOPWORDS.size).toBeGreaterThan(20);
    expect(MEMORY_STOPWORDS.has("the")).toBe(true);
  });

  it("weights the seed above the graph walk", () => {
    expect(MEMORY_WEIGHT_SEED).toBeGreaterThan(MEMORY_WEIGHT_GRAPH);
  });
});

describe("memorySeedLimit", () => {
  it("multiplies the requested top", () => {
    expect(memorySeedLimit(10)).toBe(30);
  });

  it("never drops below the floor, so a small top still seeds a graph walk", () => {
    expect(memorySeedLimit(1)).toBe(MEMORY_SEED_MIN);
    expect(memorySeedLimit(0)).toBe(MEMORY_SEED_MIN);
  });
});
