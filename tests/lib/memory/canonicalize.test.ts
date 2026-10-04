import { describe, expect, it } from "vitest";
import { FUNCTIONAL_PREDICATES } from "@/constants/memory";
import {
  isFunctionalPredicate,
  normalizeEntityName,
  normalizePredicate,
  predicateEmbeddingText,
} from "@/lib/memory/canonicalize";

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

  it("keeps the symbols that distinguish technical names", () => {
    // "C++", "C#" and "C" are three languages, not three spellings of one. A
    // strip-everything rule collapses all three to "c", so a user who writes
    // C++ and later C# gets one entity and the second fact supersedes the
    // first — a wrong answer in exactly the area this feature exists for.
    expect(normalizeEntityName("C++")).toBe("c++");
    expect(normalizeEntityName("C#")).toBe("c#");
    expect(normalizeEntityName("C")).toBe("c");
  });

  it("still strips a trailing sentence period from an ordinary name", () => {
    // Keeping "+" and "#" must not turn prose punctuation into part of a name.
    expect(normalizeEntityName("Acme Corp.")).toBe("acme corp");
  });

  it("returns an empty string for input with no letters or digits", () => {
    // The empty name must never reach a MERGE: the store keys a `:Entity` on
    // `(userId, normalizedName)`, so "" is a junk node every punctuation-only
    // surface in that one user's corpus collapses into.
    expect(normalizeEntityName("()")).toBe("");
    expect(normalizeEntityName("'s")).toBe("");
    expect(normalizeEntityName("   ")).toBe("");
    expect(normalizeEntityName("")).toBe("");
  });
});

describe("normalizePredicate", () => {
  it("collapses separator, case and surrounding space to one name", () => {
    const expected = "PRODUCT_OF";
    expect(normalizePredicate("PRODUCT_OF")).toBe(expected);
    expect(normalizePredicate("product_of")).toBe(expected);
    expect(normalizePredicate("  Product Of ")).toBe(expected);
    expect(normalizePredicate("product of")).toBe(expected);
    expect(normalizePredicate("product-of")).toBe(expected);
  });

  it("collapses runs of separators rather than emitting an empty segment", () => {
    expect(normalizePredicate("is   made_ _by")).toBe("IS_MADE_BY");
  });

  it("keeps letters outside ASCII rather than mangling the word", () => {
    expect(normalizePredicate("créé par")).toBe("CRÉÉ_PAR");
  });

  it("returns an empty string for input that carries no letters or digits", () => {
    expect(normalizePredicate("")).toBe("");
    expect(normalizePredicate("   ")).toBe("");
    expect(normalizePredicate("?!")).toBe("");
  });

  it("is idempotent, so a canonical name re-normalizes to itself", () => {
    const once = normalizePredicate("Made By");
    expect(normalizePredicate(once)).toBe(once);
  });
});

describe("predicateEmbeddingText", () => {
  it("embeds the relation in a template, not as a bare two-word string", () => {
    expect(predicateEmbeddingText("PRODUCT_OF")).toBe("X product of Y");
  });

  it("is stable for the empty predicate rather than throwing", () => {
    expect(predicateEmbeddingText("")).toBe("X  Y");
  });
});

describe("isFunctionalPredicate", () => {
  it("recognises a predicate the extractor defaulted to `add`", () => {
    expect(isFunctionalPredicate("WORKS_AS")).toBe(true);
  });

  it("is false for a multi-valued predicate", () => {
    expect(isFunctionalPredicate("LIKES")).toBe(false);
  });

  it("names only canonical forms, so a surface form does not match", () => {
    expect(isFunctionalPredicate("works as")).toBe(false);
    for (const name of FUNCTIONAL_PREDICATES) {
      expect(isFunctionalPredicate(name)).toBe(true);
    }
  });
});
