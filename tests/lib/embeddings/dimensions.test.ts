import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
import {
  EmbeddingDimensionError,
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "@/lib/embeddings/dimensions";

describe("assertEmbeddingDimensions", () => {
  it("accepts an embedding at the index contract width", () => {
    expect(() =>
      assertEmbeddingDimensions(
        new Array<number>(EMBEDDING_DIMENSIONS).fill(0),
        "test",
      ),
    ).not.toThrow();
  });

  it("throws a typed contract error when the model's width changed", () => {
    let caught: unknown;
    try {
      assertEmbeddingDimensions(
        new Array<number>(EMBEDDING_DIMENSIONS + 256).fill(0),
        "test",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EmbeddingDimensionError);
    expect(isEmbeddingDimensionError(caught)).toBe(true);
  });

  it("names both widths, so the misconfiguration is readable without a debugger", () => {
    const error = new EmbeddingDimensionError(1024, 768, "generateEmbedding");

    expect(error.message).toContain("1024");
    expect(error.message).toContain("768");
    expect(error.actual).toBe(1024);
    expect(error.expected).toBe(768);
  });
});

describe("isEmbeddingDimensionError", () => {
  it("is false for a provider outage, which must still degrade to a null vector", () => {
    expect(isEmbeddingDimensionError(new Error("fetch failed"))).toBe(false);
  });

  it("is false for a thrown non-Error", () => {
    expect(isEmbeddingDimensionError("embedding failed")).toBe(false);
  });
});
