import { OllamaEmbeddings } from "@langchain/ollama";
import {
  normalizeTextForEmbedding,
  truncateByEstimatedTokenBudget,
} from "../lib/embeddings/text";

const EMBEDDING_DIMENSIONS = 768;
const failures: string[] = [];

function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok" : "FAIL"}: ${name} — ${detail}`);
  if (!ok) failures.push(name);
}

async function main(): Promise<void> {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  if (!baseUrl) {
    console.error("OLLAMA_BASE_URL is not set. Add it to .env before running this.");
    process.exit(1);
  }

  const embeddings = new OllamaEmbeddings({
    model: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
    baseUrl,
    ...(process.env.OLLAMA_API_KEY
      ? { headers: { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } }
      : {}),
    truncate: true,
    maxRetries: 3,
  });

  const cases: { name: string; text: string }[] = [
    { name: "short text", text: "I deploy on Fridays." },
    // Far past the token budget: this is the case the head/tail truncation
    // exists for, and the one that used to throw a context-length error.
    { name: "over-budget text", text: "deploy window ".repeat(20_000) },
    // An empty string must not throw — an empty document is a real input.
    { name: "empty text", text: "" },
    { name: "punctuation only", text: "!!! ??? *** ..." },
  ];

  for (const testCase of cases) {
    try {
      const vector = await embeddings.embedQuery(
        truncateByEstimatedTokenBudget(
          normalizeTextForEmbedding(testCase.text),
        ),
      );
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
    console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
