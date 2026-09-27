import { logger } from "@/lib/logger";
import { config } from "@/lib/config";
import { OllamaEmbeddings } from "@langchain/ollama";

const EMBEDDING_MAX_INPUT_TOKENS = 8192;
const EMBEDDING_TOKEN_SAFETY_MARGIN = 256;
const EMBEDDING_TOKEN_BUDGET =
  EMBEDDING_MAX_INPUT_TOKENS - EMBEDDING_TOKEN_SAFETY_MARGIN;
const ESTIMATED_CHARS_PER_TOKEN = 3;
const TRUNCATION_SEPARATOR = "\n...\n";

type PreparedEmbeddingText = {
  text: string;
  wasTruncated: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
};

/**
 * Initialize Ollama embeddings.
 *
 * `dimensions` is only forwarded when OLLAMA_EMBEDDING_DIMENSIONS is set, since
 * most Ollama embedding models reject a custom width. Whatever width the model
 * produces must match the Azure AI Search indexes' `vectorSearchDimensions`
 * (see MEMORY_VECTOR_DIMENSIONS), so changing the embedding model means
 * recreating those indexes and re-embedding existing content.
 */
function getEmbeddingsInstance() {
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
  const dimensions = config.ollama.embeddingDimensions;

  return new OllamaEmbeddings({
    model,
    baseUrl,
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    ...(dimensions ? { dimensions } : {}),
    // Let the server clamp over-long inputs rather than erroring on them.
    truncate: true,
    maxRetries: 3,
  });
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

function normalizeTextForEmbedding(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateByEstimatedTokenBudget(text: string): PreparedEmbeddingText {
  const normalized = normalizeTextForEmbedding(text);
  const estimatedTokensBefore = estimateTokenCount(normalized);

  if (estimatedTokensBefore <= EMBEDDING_TOKEN_BUDGET) {
    return {
      text: normalized,
      wasTruncated: false,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
    };
  }

  const allowedChars = Math.max(
    EMBEDDING_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN,
    512,
  );

  if (allowedChars <= TRUNCATION_SEPARATOR.length + 2) {
    const fallback = normalized.slice(0, allowedChars);
    return {
      text: fallback,
      wasTruncated: true,
      estimatedTokensBefore,
      estimatedTokensAfter: estimateTokenCount(fallback),
    };
  }

  const headBudget = Math.floor((allowedChars - TRUNCATION_SEPARATOR.length) * 0.7);
  const tailBudget = allowedChars - TRUNCATION_SEPARATOR.length - headBudget;
  const head = normalized.slice(0, headBudget);
  const tail = normalized.slice(-tailBudget);
  const truncated = `${head}${TRUNCATION_SEPARATOR}${tail}`;

  return {
    text: truncated,
    wasTruncated: true,
    estimatedTokensBefore,
    estimatedTokensAfter: estimateTokenCount(truncated),
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function isContextLengthError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("maximum context length") &&
    message.includes("requested") &&
    message.includes("tokens")
  );
}

function parseContextLengthError(
  error: unknown,
): { maxTokens: number; requestedTokens: number } | null {
  const message = getErrorMessage(error);
  const match = message.match(
    /maximum context length is\s+(\d+)\s+tokens.*requested\s+(\d+)\s+tokens/i,
  );
  if (!match) return null;

  const maxTokens = Number.parseInt(match[1], 10);
  const requestedTokens = Number.parseInt(match[2], 10);
  if (!Number.isFinite(maxTokens) || !Number.isFinite(requestedTokens)) {
    return null;
  }

  return { maxTokens, requestedTokens };
}

function shrinkTextForRetry(text: string, error: unknown): string | null {
  const parsed = parseContextLengthError(error);
  if (!parsed) return null;

  const safetyBudget = Math.max(parsed.maxTokens - EMBEDDING_TOKEN_SAFETY_MARGIN, 1);
  const ratio = Math.min(safetyBudget / parsed.requestedTokens, 0.95);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const nextLength = Math.max(Math.floor(text.length * ratio), 256);
  if (nextLength >= text.length) return null;

  return text.slice(0, nextLength);
}

/**
 * Generate embedding for a single text using Ollama
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embeddings = getEmbeddingsInstance();
  const prepared = truncateByEstimatedTokenBudget(text);

  if (prepared.wasTruncated) {
    logger.warn(
      `[Embeddings] Truncated input for embedding (${prepared.estimatedTokensBefore} -> ~${prepared.estimatedTokensAfter} estimated tokens)`,
    );
  }

  try {
    const result = await embeddings.embedQuery(prepared.text);
    return result;
  } catch (error) {
    if (isContextLengthError(error)) {
      const retryText = shrinkTextForRetry(prepared.text, error);
      if (retryText && retryText.length > 0) {
        logger.warn(
          `[Embeddings] Retrying single embedding with shorter input after context-length error`,
        );
        try {
          return await embeddings.embedQuery(retryText);
        } catch (retryError) {
          logger.error(
            `[Embeddings] Error generating single embedding after retry: ${retryError}`,
          );
          throw retryError;
        }
      }
    }

    logger.error(`[Embeddings] Error generating single embedding: ${error}`);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts with rate limit handling
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const preparedTexts = texts.map((text) => truncateByEstimatedTokenBudget(text));
  const truncatedCount = preparedTexts.reduce(
    (count, item) => (item.wasTruncated ? count + 1 : count),
    0,
  );

  try {
    const embeddings = getEmbeddingsInstance();

    logger.info(
      `[Embeddings] Generating embeddings for ${texts.length} texts using LangChain...`,
    );
    if (truncatedCount > 0) {
      logger.warn(
        `[Embeddings] Truncated ${truncatedCount}/${texts.length} input text(s) before batch embedding`,
      );
    }

    // LangChain's embedDocuments handles batching and concurrency
    const results = await embeddings.embedDocuments(
      preparedTexts.map((item) => item.text),
    );

    logger.info(
      `[Embeddings] Successfully generated ${results.length} embeddings`,
    );
    return results;
  } catch (error) {
    if (isContextLengthError(error)) {
      logger.warn(
        `[Embeddings] Batch embedding hit context limit. Falling back to guarded single-item embedding.`,
      );
      const results: number[][] = [];
      for (const text of preparedTexts) {
        results.push(await generateEmbedding(text.text));
      }
      return results;
    }

    logger.error(`[Embeddings] Error generating multiple embeddings: ${error}`);
    throw error;
  }
}
