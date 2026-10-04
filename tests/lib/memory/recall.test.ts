import { describe, expect, it } from "vitest";
import { MEMORY_TRAVERSAL_DECAY, MEMORY_WEIGHT_GRAPH, MEMORY_WEIGHT_SEED } from "@/constants/memory";
import {
  hopDecay,
  mergeRecallCandidates,
  rankRecall,
  recencyBonus,
} from "@/lib/memory/recall";

const candidate = (over: Partial<Parameters<typeof rankRecall>[0][number]> = {}) => ({
  id: "m1",
  content: "I deploy on Fridays",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  vectorScore: 0.9,
  hops: 0,
  pathWeight: 1,
  ...over,
});

describe("hopDecay", () => {
  it("is 1 for a seed", () => {
    expect(hopDecay(0)).toBe(1);
  });

  it("decays per hop", () => {
    expect(hopDecay(1)).toBeCloseTo(MEMORY_TRAVERSAL_DECAY, 12);
    expect(hopDecay(2)).toBeCloseTo(MEMORY_TRAVERSAL_DECAY ** 2, 12);
  });

  it("treats a negative hop count as a seed rather than amplifying it", () => {
    expect(hopDecay(-1)).toBe(1);
  });
});

describe("recencyBonus", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("is larger for a fresher memory", () => {
    const fresh = recencyBonus("2026-05-31T00:00:00.000Z", now);
    const old = recencyBonus("2020-01-01T00:00:00.000Z", now);
    expect(fresh).toBeGreaterThan(old);
  });

  it("stays within [0, 1]", () => {
    expect(recencyBonus("2030-01-01T00:00:00.000Z", now)).toBeLessThanOrEqual(1);
    expect(recencyBonus("2030-01-01T00:00:00.000Z", now)).toBeGreaterThanOrEqual(0);
    expect(recencyBonus("1990-01-01T00:00:00.000Z", now)).toBeGreaterThanOrEqual(0);
  });

  it("is 0 for an unparseable date rather than NaN", () => {
    expect(recencyBonus("not a date", now)).toBe(0);
    expect(recencyBonus("", now)).toBe(0);
  });
});

describe("rankRecall", () => {
  it("returns empty for an empty seed set — the D2 regression", () => {
    // The old code fell through to allMemories.slice(0, safeTop), returning
    // unrelated rows as if they were matches. Nothing must be fabricated.
    expect(rankRecall([])).toEqual([]);
  });

  it("honours the seed weight over the graph weight", () => {
    const result = rankRecall([
      candidate({ id: "seed", vectorScore: 1, hops: 0, pathWeight: 0 }),
      candidate({ id: "walked", vectorScore: 0, hops: 1, pathWeight: 1 }),
    ]);
    expect(result[0].id).toBe("seed");
  });

  it("applies the hop decay, so a two-hop path scores below a one-hop path", () => {
    const result = rankRecall([
      candidate({ id: "near", vectorScore: 0, hops: 1, pathWeight: 1 }),
      candidate({ id: "far", vectorScore: 0, hops: 2, pathWeight: 1 }),
    ]);
    expect(result[0].id).toBe("near");
  });

  it("sorts by score descending", () => {
    const result = rankRecall([
      candidate({ id: "low", vectorScore: 0.1 }),
      candidate({ id: "high", vectorScore: 0.9 }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["high", "low"]);
  });

  it("truncates to top without inventing rows", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `m${i}`, vectorScore: 1 - i / 100 }),
    );
    const result = rankRecall(many, { top: 5 });
    expect(result).toHaveLength(5);
    expect(new Set(result.map((r) => r.id)).size).toBe(5);
  });

  it("returns fewer than top when there are fewer candidates", () => {
    expect(rankRecall([candidate()], { top: 10 })).toHaveLength(1);
  });

  it("uses the documented weights", () => {
    const result = rankRecall([candidate({ vectorScore: 1, hops: 0, pathWeight: 0, createdAt: "1990-01-01T00:00:00.000Z" })]);
    expect(result[0].score).toBeCloseTo(MEMORY_WEIGHT_SEED, 1);
    expect(MEMORY_WEIGHT_GRAPH).toBeLessThan(MEMORY_WEIGHT_SEED);
  });
});

describe("mergeRecallCandidates", () => {
  it("counts only the nodes the traversal actually added", () => {
    // This is what `graphExpandedCount` reports. A reached row can be one the
    // seeds already named, so counting `expanded.length` reports rows the
    // dedupe then discarded, and reads as "the graph reached N memories" when
    // it reached none. The count has to be of rows that were not already
    // seeded, or the one metric an operator has for whether the graph is doing
    // anything is a fiction.
    const seeds = [
      candidate({ id: "a", vectorScore: 0.9 }),
      candidate({ id: "b", vectorScore: 0.8 }),
    ];
    const expanded = [
      candidate({ id: "a", hops: 1, vectorScore: 0, pathWeight: 1 }),
      candidate({ id: "c", hops: 1, vectorScore: 0, pathWeight: 1 }),
    ];

    const merged = mergeRecallCandidates(seeds, expanded);

    expect(merged.addedCount).toBe(1);
    expect(merged.candidates.map((row) => row.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the best hop count when a node is reached more than once", () => {
    const seeds = [candidate({ id: "a" })];
    const expanded = [
      candidate({ id: "a", hops: 2, pathWeight: 0.36 }),
      candidate({ id: "a", hops: 1, pathWeight: 0.6 }),
    ];

    const merged = mergeRecallCandidates(seeds, expanded);

    expect(merged.candidates).toHaveLength(1);
    expect(merged.candidates[0].hops).toBe(0);
    expect(merged.addedCount).toBe(0);
  });

  it("counts nothing when the traversal found nothing new", () => {
    const seeds = [candidate({ id: "a" })];
    expect(mergeRecallCandidates(seeds, []).addedCount).toBe(0);
    expect(mergeRecallCandidates([], []).candidates).toEqual([]);
  });
});
