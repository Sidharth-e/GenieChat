import { describe, it, expect } from "vitest";
import {
  hydrateDocument,
  escapeRegex,
  buildSearchFilter,
  splitNullFields,
} from "@/lib/mongodb/common";

describe("hydrateDocument", () => {
  it("maps _id to id", () => {
    const result = hydrateDocument({ _id: "abc-123", title: "Hello" } as never);
    expect(result).toEqual({ id: "abc-123", title: "Hello" });
  });

  it("does not leak the _id key", () => {
    const result = hydrateDocument({ _id: "abc-123" } as never) as Record<string, unknown>;
    expect(result).not.toHaveProperty("_id");
    expect(Object.keys(result)).toEqual(["id"]);
  });

  it("preserves all other fields", () => {
    const result = hydrateDocument({
      _id: "id-1",
      userId: "user-1",
      type: "agent",
      nested: { a: 1 },
    } as never) as Record<string, unknown>;
    expect(result.userId).toBe("user-1");
    expect(result.type).toBe("agent");
    expect(result.nested).toEqual({ a: 1 });
  });
});

/** Every token `escapeRegex` must neutralise: the 14 RegExp metacharacters. */
const METACHARACTERS = ".*+?^${}()|[]\\";

describe("escapeRegex", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
    expect(escapeRegex("a.b")).toBe("a\\.b");
    expect(escapeRegex("(x)")).toBe("\\(x\\)");
    expect(escapeRegex("a|b")).toBe("a\\|b");
  });

  it("leaves ordinary text unchanged", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
  });

  it("handles an empty string", () => {
    expect(escapeRegex("")).toBe("");
  });

  it("produces a pattern that matches the literal input", () => {
    const input = "a+b";
    expect(new RegExp(escapeRegex(input)).test(input)).toBe(true);
  });

  it("escapes every metacharacter so the pattern stays valid and literal", () => {
    for (const char of METACHARACTERS) {
      const escaped = escapeRegex(char);
      // This catches the tokens whose unescaped form is a hard SyntaxError
      // ("[" and "\"). It cannot see "^", "$" or "]" — see the two tests
      // below, which exist precisely because this form is blind to them.
      expect(() => new RegExp(escaped)).not.toThrow();
      expect(new RegExp(escaped).test(`x${char}y`)).toBe(true);
    }
  });

  it("round-trips a term containing every metacharacter", () => {
    const escaped = escapeRegex(METACHARACTERS);

    expect(() => new RegExp(escaped)).not.toThrow();
    // Escaping the *whole* term is what makes the pattern literal, so a single
    // dropped metacharacter breaks the round-trip: a raw "^" or "$" sitting
    // mid-pattern can never match (both are zero-width and only assert at the
    // start/end of the input). Matching one character in isolation cannot
    // catch those two — `new RegExp("^").test("x^y")` is `true` because `^`
    // matches the empty string at position 0 — hence the whole term here.
    expect(new RegExp(escaped).test(METACHARACTERS)).toBe(true);
  });

  it("escapes each metacharacter to its exact escaped form", () => {
    for (const char of METACHARACTERS) {
      // The only assertion that can catch a dropped "]": Annex B treats a lone
      // "]" as a valid literal, so no `new RegExp(...).test(...)` form tells it
      // apart from the escaped "\]". Comparing the exact output catches every
      // token, including "^", "$", "]" and "\".
      expect(escapeRegex(char)).toBe(`\\${char}`);
    }
  });
});

describe("splitNullFields", () => {
  it("keeps ordinary values in the set half", () => {
    expect(splitNullFields({ name: "Renamed", enabled: false })).toEqual({
      set: { name: "Renamed", enabled: false },
      unset: {},
    });
  });

  it("drops undefined rather than setting or unsetting it", () => {
    // Undefined means "leave this field alone" -- a third instruction: not a value
    // to store, and not a field to remove.
    expect(splitNullFields({ name: "Renamed", description: undefined })).toEqual({
      set: { name: "Renamed" },
      unset: {},
    });
  });

  it("moves a null field to the unset half", () => {
    // Setting null stores a null; the readers on these collections test for the
    // absent key, so an erasure has to remove it rather than blank it.
    expect(splitNullFields({ description: null })).toEqual({
      set: {},
      unset: { description: "" },
    });
  });

  it("keeps false and 0 as values, not as erasures", () => {
    // Guard against a falsy check: `enabled: false` and `maxAttempts: 0` are
    // values a caller chose, and only exact `null` is an erasure.
    expect(splitNullFields({ enabled: false, maxAttempts: 0 })).toEqual({
      set: { enabled: false, maxAttempts: 0 },
      unset: {},
    });
  });
});

describe("buildSearchFilter", () => {
  it("builds a case-insensitive OR across the given fields", () => {
    const filter = buildSearchFilter("hello", ["title", "content"]);
    expect(filter).toEqual({
      $or: [
        { title: /hello/i },
        { content: /hello/i },
      ],
    });
  });

  it("escapes metacharacters in the term", () => {
    const filter = buildSearchFilter("a+b", ["title"]) as {
      $or: { title: RegExp }[];
    };
    expect(filter.$or[0].title.source).toBe("a\\+b");
  });

  it("returns a single-branch $or for one field", () => {
    const filter = buildSearchFilter("q", ["title"]) as { $or: unknown[] };
    expect(filter.$or).toHaveLength(1);
  });
});
