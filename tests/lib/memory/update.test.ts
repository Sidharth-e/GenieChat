import { describe, expect, it } from "vitest";
import { buildMemoryUpdateSet, normalizeMemoryCategory } from "@/lib/memory/update";

describe("normalizeMemoryCategory", () => {
  it("keeps a category the store recognises", () => {
    expect(normalizeMemoryCategory("fact")).toBe("fact");
    expect(normalizeMemoryCategory("other")).toBe("other");
  });

  it("drops a category outside the set rather than writing it", () => {
    // MEMORY_CATEGORIES is the only runtime check on this field. Without it an
    // unrecognised string lands on the node and the prompt line renders
    // `- [nonsense] ...`.
    expect(normalizeMemoryCategory("nonsense")).toBeUndefined();
    expect(normalizeMemoryCategory("Fact")).toBeUndefined();
  });

  it("drops a non-string without throwing", () => {
    expect(normalizeMemoryCategory(null)).toBeUndefined();
    expect(normalizeMemoryCategory(undefined)).toBeUndefined();
    expect(normalizeMemoryCategory(7)).toBeUndefined();
    expect(normalizeMemoryCategory({ category: "fact" })).toBeUndefined();
    expect(normalizeMemoryCategory("")).toBeUndefined();
  });
});

describe("buildMemoryUpdateSet", () => {
  it("keeps the fields a caller may edit", () => {
    const set = buildMemoryUpdateSet({ content: "new", category: "fact" });
    expect(set).toEqual({ content: "new", category: "fact" });
  });

  it("drops an unrecognised category instead of writing it", () => {
    const set = buildMemoryUpdateSet({ content: "x", category: "nonsense" as never });
    expect(set).toEqual({ content: "x" });
  });

  it("drops userId, so a body cannot re-own a memory", () => {
    expect(buildMemoryUpdateSet({ content: "x", userId: "attacker" })).toEqual({
      content: "x",
    });
  });

  it("drops createdAt, so a body cannot re-date a memory", () => {
    expect(
      buildMemoryUpdateSet({ content: "x", createdAt: "1990-01-01T00:00:00.000Z" }),
    ).toEqual({ content: "x" });
  });

  it("drops enrichedAt, which only the enrichment sweep may set", () => {
    expect(buildMemoryUpdateSet({ content: "x", enrichedAt: "2026-01-01T00:00:00.000Z" })).toEqual({
      content: "x",
    });
  });

  it("drops embedding, which is derived from content and never set by hand", () => {
    const set = buildMemoryUpdateSet({
      content: "x",
      embedding: [0.1, 0.2],
    } as never);
    expect(set).toEqual({ content: "x" });
  });

  it("drops unknown keys entirely", () => {
    const set = buildMemoryUpdateSet({ content: "x", injected: "DROP DATABASE" } as never);
    expect(Object.keys(set)).toEqual(["content"]);
  });

  it("drops undefined values rather than writing null over a field", () => {
    expect(buildMemoryUpdateSet({ content: undefined, category: "fact" })).toEqual({
      category: "fact",
    });
  });

  it("returns an empty object for an empty update", () => {
    expect(buildMemoryUpdateSet({})).toEqual({});
  });

  it("keeps userName and userEmail, which the save tool legitimately refreshes", () => {
    expect(buildMemoryUpdateSet({ userName: "Ada", userEmail: "ada@example.com" })).toEqual({
      userName: "Ada",
      userEmail: "ada@example.com",
    });
  });
});
