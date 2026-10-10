import "server-only";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "./dimensions";
import {
  estimateTokenCount,
  getErrorMessage,
  isContextLengthError,
  normalizeTextForEmbedding,
  parseContextLengthError,
  shrinkTextForRetry,
  truncateByEstimatedTokenBudget,
} from "./text";

export {
  EmbeddingDimensionError,
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "./dimensions";

export const openRouterEmbeddingClient: AxiosInstance = axios.create({
  baseURL: "https://openrouter.ai/api/v1",
  timeout: config.openrouter.embeddingTimeoutMs,
  headers: {
    "Content-Type": "application/json",
  },
});

openRouterEmbeddingClient.interceptors.request.use((reqConfig) => {
  const apiKey = config.openrouter.apiKey;
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key not configured. Set OPENROUTER_API_KEY.",
    );
  }
  reqConfig.headers.Authorization = `Bearer ${apiKey}`;
  return reqConfig;
});

openRouterEmbeddingClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      "OpenRouter embedding request failed";
    return Promise.reject(new Error(message));
  },
);

const embeddingDataSchema = z.object({
  embedding: z.array(z.number()),
  index: z.number().optional(),
});

const openRouterEmbeddingResponseSchema = z.object({
  data: z.array(embeddingDataSchema).min(1),
  model: z.string().optional(),
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const model = config.openrouter.embeddingModel;
  if (!model) {
    throw new Error(
      "OpenRouter embedding model not configured. Set OPENROUTER_EMBEDDING_MODEL.",
    );
  }

  let candidate = truncateByEstimatedTokenBudget(
    normalizeTextForEmbedding(text),
  );
  let lastError: unknown = null;
  const original = candidate;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const textToEmbed = candidate.trim() || ".";
      const response = await openRouterEmbeddingClient.post("/embeddings", {
        model,
        input: textToEmbed,
      });

      const parsed = openRouterEmbeddingResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new Error(
          `Invalid response structure from OpenRouter embeddings: ${parsed.error.message}`,
        );
      }

      const embedding = parsed.data.data[0].embedding;
      assertEmbeddingDimensions(embedding, "generateEmbedding");
      return embedding;
    } catch (error) {
      lastError = error;
      if (isEmbeddingDimensionError(error)) throw error;
      if (isContextLengthError(error)) {
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
        continue;
      }

      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      throw error;
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
