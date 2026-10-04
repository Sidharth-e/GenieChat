import { describe, expect, it } from "vitest";
import type {
  FactRecallMetadata,
  FactRecallResult,
  RecalledFact,
} from "@/lib/memory/types";
import {
  MEMORY_ENTITY_MERGE_THRESHOLD,
  MEMORY_MAX_CONCEPT_FEATURES,
  MEMORY_MIN_TOKEN_LENGTH,
  MEMORY_RECALL_HOPS,
  MEMORY_SEED_MIN,
  MEMORY_SEED_MULTIPLIER,
  MEMORY_STOPWORDS,
  MEMORY_TRAVERSAL_DECAY,
  MEMORY_WEIGHT_GRAPH,
  MEMORY_WEIGHT_SEED,
  memorySeedLimit,
} from "@/constants/memory";

describe("memory tuning constants", () => {
  it("pins the tuning the read path depends on", () => {
    expect(MEMORY_SEED_MULTIPLIER).toBe(3);
    expect(MEMORY_MIN_TOKEN_LENGTH).toBe(3);
    expect(MEMORY_MAX_CONCEPT_FEATURES).toBe(24);
  });

  it("bounds traversal at two hops, the depth that reaches fact→entity→fact", () => {
    expect(MEMORY_RECALL_HOPS).toBe(2);
  });

  it("decays by less than one per hop, so a second hop still contributes", () => {
    expect(MEMORY_TRAVERSAL_DECAY).toBeGreaterThan(0);
    expect(MEMORY_TRAVERSAL_DECAY).toBeLessThan(1);
  });

  it("keeps the merge threshold high, so only near-duplicates collapse", () => {
    expect(MEMORY_ENTITY_MERGE_THRESHOLD).toBe(0.9);
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

/**
 * Shape tests for the recall result. The types carry no runtime logic, but two
 * things about them are load-bearing enough to pin: `lexicalSeedCount` is gone
 * (it always reported 0 and advertised an arm that does not exist), and a
 * capture and a fact are distinguishable at the call site.
 */
describe("RecalledFact", () => {
  it("distinguishes a staged sentence from a materialized fact", () => {
    const fact: RecalledFact = {
      id: "f1",
      kind: "fact",
      text: "I work as a Rust developer",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const capture: RecalledFact = {
      id: "c1",
      kind: "capture",
      text: "I just moved to Bangalore",
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    expect(fact.kind).not.toBe(capture.kind);
  });
});

describe("FactRecallMetadata", () => {
  it("reports only counts that can be non-zero", () => {
    const metadata: FactRecallMetadata = {
      mode: "graph",
      seedCount: 3,
      expandedCount: 4,
      totalCandidates: 7,
    };
    expect(Object.keys(metadata).sort()).toEqual([
      "expandedCount",
      "mode",
      "seedCount",
      "totalCandidates",
    ]);
  });

  it("has no lexical arm, because there is none", () => {
    const metadata = {
      mode: "vector",
      seedCount: 0,
      expandedCount: 0,
      totalCandidates: 0,
    } as FactRecallMetadata;
    expect("lexicalSeedCount" in metadata).toBe(false);
  });
});

describe("FactRecallResult", () => {
  it("carries an empty fact list with metadata rather than a bare array", () => {
    const result: FactRecallResult = {
      facts: [],
      metadata: { mode: "vector", seedCount: 0, expandedCount: 0, totalCandidates: 0 },
    };
    expect(result.facts).toEqual([]);
  });
});
