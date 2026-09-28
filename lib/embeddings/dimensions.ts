import { EMBEDDING_DIMENSIONS } from "@/constants/embeddings";

/**
 * The one embedding failure that must never be degraded past.
 *
 * A width mismatch is a configuration fault, not a provider outage: the model
 * behind `OLLAMA_EMBEDDING_MODEL` no longer produces the vectors the index
 * contract was built for, so retrying cannot help and every consumer of the
 * vectors is wrong from here on. It is a class rather than the message-matching
 * `isContextLengthError` uses, because that predicate has to recognise a
 * provider's own wording while this error is ours to type.
 *
 * Kept out of `index.ts` so it is testable: that module is `"server-only"`, and
 * this one has no dependencies beyond a constant.
 */
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
