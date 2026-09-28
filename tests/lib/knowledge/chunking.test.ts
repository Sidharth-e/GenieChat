import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "@/constants/knowledge";
import { chunkDocumentWithOverlap } from "@/lib/knowledge/chunking";

/** Prose with no separator at the exact cut point, to exercise the hard cut. */
const proseOf = (words: number) =>
  Array.from({ length: words }, (_, i) => `word${i}`).join(" ");

describe("chunkDocumentWithOverlap", () => {
  it("returns nothing for an empty document", () => {
    expect(chunkDocumentWithOverlap("")).toEqual([]);
  });

  it("returns nothing for a whitespace-only document", () => {
    expect(chunkDocumentWithOverlap("   \n\t  \n ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    expect(chunkDocumentWithOverlap("just one line")).toEqual(["just one line"]);
  });

  it("trims the ends of the document", () => {
    expect(chunkDocumentWithOverlap("   trimmed   ")).toEqual(["trimmed"]);
  });

  it("never emits a chunk longer than the size", () => {
    const chunks = chunkDocumentWithOverlap(proseOf(3000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("starts at the document start and ends at the document end", () => {
    const text = proseOf(3000);
    const chunks = chunkDocumentWithOverlap(text);
    expect(text.startsWith(chunks[0])).toBe(true);
    expect(text.endsWith(chunks[chunks.length - 1])).toBe(true);
  });

  it("overlaps consecutive chunks so a sentence cut in two is recoverable", () => {
    const text = "a".repeat(5000);
    const chunks = chunkDocumentWithOverlap(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i += 1) {
      const previousTail = chunks[i - 1].slice(-CHUNK_OVERLAP);
      expect(chunks[i].startsWith(previousTail)).toBe(true);
    }
  });

  it("makes progress even when overlap is larger than the size", () => {
    const chunks = chunkDocumentWithOverlap("b".repeat(1000), 100, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  it("chunks punctuation with no separator at all", () => {
    const chunks = chunkDocumentWithOverlap("!".repeat(3000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("!");
  });

  it("is deterministic", () => {
    const text = proseOf(2000);
    expect(chunkDocumentWithOverlap(text)).toEqual(
      chunkDocumentWithOverlap(text),
    );
  });

  it("prefers to cut at a paragraph break when one is available", () => {
    const first = "x".repeat(1200);
    const second = "y".repeat(1200);
    const chunks = chunkDocumentWithOverlap(`${first}\n\n${second}`, 2000, 200);
    expect(chunks[0]).toBe(first);
  });
});
