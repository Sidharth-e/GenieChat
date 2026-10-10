import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "../constants/embeddings";
import {
  normalizeTextForEmbedding,
  truncateByEstimatedTokenBudget,
} from "../lib/embeddings/text";

const failures: string[] = [];

function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAIL"}: ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

const embeddingDataSchema = z.object({
  embedding: z.array(z.number()),
  index: z.number().optional(),
});

const openRouterEmbeddingResponseSchema = z.object({
  data: z.array(embeddingDataSchema).min(1),
  model: z.string().optional(),
});

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      "OPENROUTER_API_KEY is not set. Add it to .env before running this.",
    );
    process.exit(1);
  }

  const model =
    process.env.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  const client: AxiosInstance = axios.create({
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 60_000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  client.interceptors.response.use(
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

  const cases: { name: string; text: string }[] = [
    { name: "short text", text: "I deploy on Fridays." },
    { name: "over-budget text", text: "deploy window ".repeat(20_000) },
    { name: "empty text", text: "" },
    { name: "punctuation only", text: "!!! ??? *** ..." },
  ];

  for (const testCase of cases) {
    try {
      const candidate = truncateByEstimatedTokenBudget(
        normalizeTextForEmbedding(testCase.text),
      );
      const textToEmbed = candidate.trim() || ".";
      const response = await client.post("/embeddings", {
        model,
        input: textToEmbed,
      });

      const parsed = openRouterEmbeddingResponseSchema.parse(response.data);
      const vector = parsed.data[0].embedding;
      const ok = vector.length === EMBEDDING_DIMENSIONS;
      report(testCase.name, ok, `width=${vector.length}`);
    } catch (error) {
      report(
        testCase.name,
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} check(s) failed: ${failures.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
