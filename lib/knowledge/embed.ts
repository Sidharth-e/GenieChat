import { isEmbeddingDimensionError } from "@/lib/embeddings/dimensions";

/** A chunk text paired with the vector it will be stored under. */
export interface EmbeddedChunk {
  /** Position in the caller's `contents`, so blank chunks do not shift it. */
  chunkIndex: number;
  content: string;
  /** null when the provider was unavailable; the text is still searchable lexically. */
  embedding: number[] | null;
}

export interface EmbedFailure {
  chunkIndex: number;
  error: unknown;
}

/**
 * Turn chunk texts into insert-ready rows before any database work begins.
 *
 * Two things the ordering buys. The writer's replace holds row locks on the
 * owner for the length of its transaction, so embedding inside it would hold
 * them across one HTTP round trip per chunk: a 200-chunk document would block a
 * concurrent re-upload of the same document for the whole of it, and a request
 * timeout would leave the transaction and its connection open until reaped.
 * And a width mismatch now surfaces before the previous chunks are cleared, so
 * a misconfigured model leaves the existing index intact rather than replacing
 * it with rows that have no vectors.
 *
 * A provider failure degrades that one chunk to a null vector and is reported
 * back rather than thrown: a knowledge base that is searchable lexically beats
 * a failed upload. A contract failure is rethrown, because it degrades every
 * chunk and would quietly downgrade every later search to its lexical arm.
 *
 * The embedder is a parameter so this policy is testable without a provider,
 * and so a lexical-only caller can omit it entirely.
 */
export async function embedChunkRows(
  contents: string[],
  embed?: (text: string) => Promise<number[]>,
): Promise<{ rows: EmbeddedChunk[]; failures: EmbedFailure[] }> {
  const rows: EmbeddedChunk[] = [];
  const failures: EmbedFailure[] = [];

  for (let chunkIndex = 0; chunkIndex < contents.length; chunkIndex += 1) {
    const content = contents[chunkIndex].trim();
    if (!content) continue;

    if (!embed) {
      rows.push({ chunkIndex, content, embedding: null });
      continue;
    }

    try {
      rows.push({ chunkIndex, content, embedding: await embed(content) });
    } catch (error) {
      if (isEmbeddingDimensionError(error)) throw error;
      failures.push({ chunkIndex, error });
      rows.push({ chunkIndex, content, embedding: null });
    }
  }

  return { rows, failures };
}
