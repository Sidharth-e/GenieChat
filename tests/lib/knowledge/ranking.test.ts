import { describe, expect, it } from "vitest";
import { RRF_K } from "@/constants/knowledge";
import { combineRrf, rrfScore } from "@/lib/knowledge/ranking";

describe("rrfScore", () => {
  it("scores rank 1 highest", () => {
    expect(rrfScore(1)).toBeCloseTo(1 / (RRF_K + 1), 12);
  });

  it("decays with rank", () => {
    expect(rrfScore(1)).toBeGreaterThan(rrfScore(2));
    expect(rrfScore(2)).toBeGreaterThan(rrfScore(100));
  });

  it("rejects a zero or negative rank, which has no meaning in a ranking", () => {
    expect(() => rrfScore(0)).toThrow(/1-based/);
    expect(() => rrfScore(-1)).toThrow(/1-based/);
  });

  it("is unaffected by the magnitude of the underlying scores", () => {
    // The whole point of RRF: only order matters, so a cosine distance and a
    // ts_rank never need to be put on the same scale.
    expect(rrfScore(3)).toBeCloseTo(1 / (RRF_K + 3), 12);
  });
});

describe("combineRrf", () => {
  it("returns nothing for no lists", () => {
    expect(combineRrf([])).toEqual([]);
  });

  it("preserves a single list's order", () => {
    expect(combineRrf([["a", "b", "c"]]).map((h) => h.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ranks an item present in both lists above one present in only one", () => {
    const fused = combineRrf([
      ["shared", "vector-only"],
      ["lexical-only", "shared"],
    ]);
    expect(fused[0].id).toBe("shared");
  });

  it("sums the contributions of an item that appears in both lists", () => {
    const fused = combineRrf([["a"], ["a"]]);
    expect(fused[0].score).toBeCloseTo(2 * rrfScore(1), 12);
  });

  it("ignores an empty ranking rather than erroring", () => {
    const fused = combineRrf([[], ["solo"]]);
    expect(fused).toEqual([{ id: "solo", score: rrfScore(1) }]);
  });

  it("counts a duplicated id once per list", () => {
    const fused = combineRrf([["dup", "dup"]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].score).toBeCloseTo(rrfScore(1), 12);
  });

  it("breaks score ties by first appearance", () => {
    const fused = combineRrf([["first"], ["second"]]);
    expect(fused.map((h) => h.id)).toEqual(["first", "second"]);
  });

  it("returns every distinct id across the lists", () => {
    const fused = combineRrf([["a", "b"], ["c"]]);
    expect(fused.map((h) => h.id).sort()).toEqual(["a", "b", "c"]);
  });
});
