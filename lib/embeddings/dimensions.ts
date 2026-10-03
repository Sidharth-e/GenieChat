import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";
export class EmbeddingDimensionError extends Error {
  readonly actual: number;
  readonly expected: number;

  constructor(actual: number, expected: number, context: string) {
    super(
      `${context}: embedding width ${actual} does not match the index contract (${expected}). ` +
        `Check OPENROUTER_EMBEDDING_MODEL against EMBEDDING_DIMENSIONS.`,
    );
    this.name = "EmbeddingDimensionError";
    this.actual = actual;
    this.expected = expected;
  }
}

export function assertEmbeddingDimensions(
  embedding: number[],
  context: string,
): void {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingDimensionError(
      embedding.length,
      EMBEDDING_DIMENSIONS,
      context,
    );
  }
}

export function isEmbeddingDimensionError(error: unknown): boolean {
  return error instanceof EmbeddingDimensionError;
}
