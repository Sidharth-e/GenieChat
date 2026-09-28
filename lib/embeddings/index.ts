import "server-only";
import { OllamaEmbeddings } from "@langchain/ollama";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { assertEmbeddingDimensions } from "./dimensions";
import {
  estimateTokenCount,
  getErrorMessage,
  isContextLengthError,
  normalizeTextForEmbedding,
  parseContextLengthError,
  shrinkTextForRetry,
  truncateByEstimatedTokenBudget,
} from "./text";

// Re-exported rather than redefined here: this layer is `"server-only"`, and the
// assertion and its error type are pure, so they live where they can be tested.
export {
  EmbeddingDimensionError,
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "./dimensions";

function getEmbeddingsInstance(): OllamaEmbeddings {
  const model = config.ollama.embeddingModel;
  if (!model) {
    throw new Error(
      "Ollama embedding model not configured. Set OLLAMA_EMBEDDING_MODEL.",
    );
  }

  const baseUrl = config.ollama.baseUrl;
  if (!baseUrl) {
    throw new Error(
      "Ollama base URL not configured. Set OLLAMA_BASE_URL (Ollama Cloud: https://ollama.com).",
    );
  }

  const apiKey = config.ollama.apiKey;

  return new OllamaEmbeddings({
    model,
    baseUrl,
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    // OLLAMA_EMBEDDING_DIMENSIONS is deliberately NOT forwarded: nomic-embed-text
    // rejects a custom width, and EMBEDDING_DIMENSIONS is already asserted on the
    // way out — a mismatch should fail loudly, not be coerced.
    // Let the server clamp over-long inputs rather than erroring on them.
    truncate: true,
    maxRetries: 3,
  });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = getEmbeddingsInstance();
  let candidate = truncateByEstimatedTokenBudget(
    normalizeTextForEmbedding(text),
  );
  let lastError: unknown = null;
  const original = candidate;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const embedding = await embeddings.embedQuery(candidate);
      assertEmbeddingDimensions(embedding, "generateEmbedding");
      return embedding;
    } catch (error) {
      lastError = error;
      if (!isContextLengthError(error)) throw error;

      const parsed = parseContextLengthError(error);
      const ratio =
        parsed && parsed.requested > 0 ? parsed.limit / parsed.requested : 0.5;
      const shrunk = shrinkTextForRetry(candidate, ratio * 0.9);
      if (!shrunk) {
        logger.error(
          { estimatedTokens: estimateTokenCount(original) },
          "Embedding failed: text cannot be shrunk any further",
        );
        throw error;
      }
      logger.warn(
        { attempt, from: candidate.length, to: shrunk.length },
        "Embedding exceeded the context window; retrying with a shorter text",
      );
      candidate = shrunk;
    }
  }

  throw new Error(
    `Failed to embed text after retries: ${getErrorMessage(lastError)}`,
  );
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
