import { describe, expect, it } from "vitest";
import {
  MEMORY_MAX_CONCEPT_FEATURES,
  MEMORY_MIN_TOKEN_LENGTH,
} from "@/constants/memory";
import {
  buildConceptSpace,
  buildConceptVector,
  conceptSimilarity,
  extractFeatures,
  lexicalSimilarity,
  normalizeQueryForRetrieval,
  takeTopScores,
  tokenize,
  tokenizeToArray,
} from "@/lib/memory/text";

describe("tokenize", () => {
  it("drops stopwords and tokens below the minimum length", () => {
    const tokens = tokenize("the cat sat on a mat");
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("cat")).toBe(true);
    expect(tokens.has("mat")).toBe(true);
  });

  it("lowercases, so casing cannot split a token", () => {
    expect(tokenize("Deploy DEPLOY deploy").has("deploy")).toBe(true);
    expect(tokenize("Deploy DEPLOY deploy").size).toBe(1);
  });

  it("returns an empty set for empty input rather than throwing", () => {
    expect(tokenize("").size).toBe(0);
    expect(tokenize("   ").size).toBe(0);
  });

  it("returns an empty set for a token of exactly one character less than the minimum", () => {
    expect(tokenize("a".repeat(MEMORY_MIN_TOKEN_LENGTH - 1)).size).toBe(0);
    expect(tokenize("a".repeat(MEMORY_MIN_TOKEN_LENGTH)).size).toBe(1);
  });
});

describe("tokenizeToArray", () => {
  it("agrees with tokenize", () => {
    expect(new Set(tokenizeToArray("alpha beta gamma"))).toEqual(
      tokenize("alpha beta gamma"),
    );
  });
});

describe("lexicalSimilarity", () => {
  it("is 1 for identical sets", () => {
    expect(lexicalSimilarity(tokenize("alpha beta"), tokenize("alpha beta"))).toBe(1);
  });

  it("is 0 when either side is empty", () => {
    // The a.size === 0 guard: without it this is a division by zero, and a
    // NaN would propagate into every edge weight silently.
    expect(lexicalSimilarity(new Set(), tokenize("alpha"))).toBe(0);
    expect(lexicalSimilarity(tokenize("alpha"), new Set())).toBe(0);
    expect(lexicalSimilarity(new Set(), new Set())).toBe(0);
  });

  it("never exceeds 1", () => {
    const a = tokenize("alpha beta gamma");
    expect(lexicalSimilarity(a, a)).toBeLessThanOrEqual(1);
  });

  it("is symmetric", () => {
    const a = tokenize("alpha beta");
    const b = tokenize("beta gamma");
    expect(lexicalSimilarity(a, b)).toBeCloseTo(lexicalSimilarity(b, a), 12);
  });
});

describe("takeTopScores", () => {
  it("returns the highest-scoring items in descending order", () => {
    const items = [{ n: 1 }, { n: 5 }, { n: 3 }];
    expect(takeTopScores(items, (i) => i.n, 2).map((i) => i.n)).toEqual([5, 3]);
  });

  it("returns everything when the limit exceeds the input", () => {
    expect(takeTopScores([{ n: 1 }], (i) => i.n, 10)).toHaveLength(1);
  });

  it("returns nothing for a zero or negative limit", () => {
    expect(takeTopScores([{ n: 1 }], (i) => i.n, 0)).toEqual([]);
    expect(takeTopScores([{ n: 1 }], (i) => i.n, -1)).toEqual([]);
  });
});

describe("extractFeatures", () => {
  it("caps the feature count", () => {
    const long = Array.from({ length: 200 }, (_, i) => `feature${i}`).join(" ");
    expect(extractFeatures(long).length).toBeLessThanOrEqual(
      MEMORY_MAX_CONCEPT_FEATURES,
    );
  });

  it("returns nothing for empty input", () => {
    expect(extractFeatures("")).toEqual([]);
  });
});

describe("concept space", () => {
  it("shares a dimension between two texts that use the same feature", () => {
    const space = buildConceptSpace(["alpha beta", "alpha gamma"]);
    const a = buildConceptVector(extractFeatures("alpha beta"), space);
    const b = buildConceptVector(extractFeatures("alpha gamma"), space);
    expect(conceptSimilarity(a, b)).toBeGreaterThan(0);
  });

  it("is 0 when either vector has no magnitude", () => {
    // The Math.min(1, ...) clamp and the zero-magnitude guard: a NaN here would
    // silently poison every downstream score.
    const zero = buildConceptVector([], new Map());
    const some = buildConceptVector(["x"], new Map([["x", 0]]));
    expect(conceptSimilarity(zero, some)).toBe(0);
    expect(conceptSimilarity(zero, zero)).toBe(0);
  });

  it("never exceeds 1", () => {
    const space = buildConceptSpace(["alpha beta"]);
    const v = buildConceptVector(extractFeatures("alpha beta"), space);
    expect(conceptSimilarity(v, v)).toBeLessThanOrEqual(1);
  });

  it("is 0 for vectors of different widths rather than a partial dot product", () => {
    // New with the dense-array representation: the source compared two Maps,
    // where a missing key simply contributed nothing. Aligning two arrays of
    // different widths would read past one of them and produce a NaN, which is
    // the same silent-poisoning failure the guards above exist to prevent.
    expect(conceptSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe("normalizeQueryForRetrieval", () => {
  it("leaves a short query alone", () => {
    expect(normalizeQueryForRetrieval("what is my deploy day")).toBe(
      "what is my deploy day",
    );
  });

  it("caps an over-long query rather than passing it through", () => {
    const huge = "word ".repeat(20_000);
    expect(normalizeQueryForRetrieval(huge).length).toBeLessThan(huge.length);
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeQueryForRetrieval("")).toBe("");
  });
});
