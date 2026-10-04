import { describe, expect, it } from "vitest";
import { selectMergePairs, type MergeCandidate } from "@/lib/memory/merge";

/** Unit vectors at the given cosine similarity, so the numbers read as scores. */
function candidate(
  id: string,
  canonicalName: string,
  score: number,
): MergeCandidate {
  return { id, canonicalName, embedding: [score, Math.sqrt(1 - score * score)] };
}

describe("selectMergePairs", () => {
  it("pairs two predicates above the threshold", () => {
    const pairs = selectMergePairs(
      [candidate("a", "PRODUCT_OF", 1), candidate("b", "MADE_BY", 0.97)],
      0.95,
    );
    expect(pairs).toEqual([{ keepId: "a", dupId: "b" }]);
  });

  it("leaves a pair below the threshold alone", () => {
    const pairs = selectMergePairs(
      [candidate("a", "LIKES", 1), candidate("b", "LOVES", 0.62)],
      0.95,
    );
    expect(pairs).toEqual([]);
  });

  it("keeps the more-used predicate, not the first one seen", () => {
    // Rewiring is not free, so the loser is whichever node has fewer facts to
    // move. Ordering by input position would move the busier node's edges.
    const pairs = selectMergePairs(
      [
        { id: "rare", canonicalName: "RARELY_USED", embedding: [1, 0], factCount: 1 },
        { id: "busy", canonicalName: "BUSY", embedding: [1, 0], factCount: 40 },
      ],
      0.95,
    );
    expect(pairs).toEqual([{ keepId: "busy", dupId: "rare" }]);
  });

  it("never spends a node twice", () => {
    // a~b~c is one cluster. Merging a<-b and b<-c would delete b twice, and the
    // second statement would match nothing.
    const pairs = selectMergePairs(
      [
        candidate("a", "A", 1),
        candidate("b", "B", 1),
        candidate("c", "C", 1),
      ],
      0.95,
    );
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].keepId, pairs[0].dupId]).size).toBe(2);
  });

  it("skips a candidate with no embedding", () => {
    // A predicate written during an embedding outage has no vector to compare.
    const pairs = selectMergePairs(
      [{ id: "a", canonicalName: "A", embedding: null }, candidate("b", "B", 1)],
      0.95,
    );
    expect(pairs).toEqual([]);
  });

  it("is deterministic — two runs over the same input agree", () => {
    const input = [
      candidate("a", "A", 1),
      candidate("b", "B", 1),
      candidate("c", "C", 1),
      candidate("d", "D", 1),
    ];
    expect(selectMergePairs(input, 0.95)).toEqual(selectMergePairs(input, 0.95));
  });
});
