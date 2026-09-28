import neo4j, { type ManagedTransaction, type Session } from "neo4j-driver";
import axios, { type AxiosInstance } from "axios";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import {
  MEMORY_EDGE_CANDIDATE_LIMIT,
  MEMORY_EDGE_NEIGHBOR_LIMIT,
} from "@/constants/memory";
import {
  EDGE_CANDIDATE_CYPHER,
  ENRICH_PENDING_CYPHER,
  MEMORY_EMBEDDING_CYPHER,
} from "@/lib/memory/cypher";
import {
  assertEmbeddingDimensions,
  isEmbeddingDimensionError,
} from "@/lib/embeddings/dimensions";
import {
  extractEnrichment,
  type ExtractionNeighbour,
} from "@/lib/memory/llm-extraction";
import {
  classifyEnrichmentOutcome,
  writeEnrichment,
} from "@/lib/memory/enrichment-write";
import type { Enrichment } from "@/lib/memory/enrichment-schema";

/**
 * The recovery sweep for memory enrichment, and for memories written while the
 * embedding provider was down.
 *
 * `ENRICH_PENDING_CYPHER`'s two predicates are one command's worth of work on
 * purpose: `enrichedAt IS NULL` picks up a memory whose background enrichment
 * failed, and `embedding IS NULL` picks up one written during an outage, which
 * may well have been enriched already. Both are indexed, so this is a cheap
 * scan rather than a corpus walk.
 *
 * Three deliberate choices, mirroring `check-memory.ts`:
 *
 * 1. It reads `process.env` directly rather than importing `@/lib/config`,
 *    because `lib/config` is `server-only` and reaches the whole `lib/env.ts`
 *    schema — an unrelated blank optional var would stop the sweep from running.
 * 2. It builds its own model and embedding clients. `lib/langchain/model-factory`
 *    and `lib/embeddings` are both `"server-only"`, and that guard does not
 *    resolve under `tsx`, so neither is reachable from here — the same reason
 *    `check-embeddings.ts` hand-builds its axios client. The *mapping* is not
 *    duplicated: the model id resolves through `AVAILABLE_MODELS`, so a
 *    renamed model cannot drift between the app and this script.
 * 3. Everything it *can* share, it does: the statements come from
 *    `@/lib/memory/cypher`, the prompt and the schema from
 *    `@/lib/memory/llm-extraction`, and the writes from
 *    `@/lib/memory/enrichment-write` — the same code the store runs, not a copy.
 *
 * A memory whose extraction fails to validate is left pending, matching
 * `enrichMemory`: it counts as `failed`, the sweep exits non-zero, and the same
 * count reappearing on every run is what tells an operator a memory is poison
 * rather than merely unlucky.
 */

const uri = process.env.NEO4J_URI;
const password = process.env.NEO4J_PASSWORD;
const user = process.env.NEO4J_USER ?? "neo4j";

if (!uri || !password) {
  console.error(
    "NEO4J_URI and NEO4J_PASSWORD must be set. This script reads them from the\n" +
      "environment; the `memory:enrich` pnpm script loads `.env` for you.",
  );
  process.exit(1);
}

const DEFAULT_EXTRACTION_MODEL = "gemma4";
const DEFAULT_ENRICH_LIMIT = 100;
const OPENROUTER_TIMEOUT_MS = 60_000;

const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
  disableLosslessIntegers: true,
});

const openRouterEmbeddingResponseSchema = z.object({
  data: z
    .array(z.object({ embedding: z.array(z.number()) }).passthrough())
    .min(1),
});

/**
 * Ollama only: `gemma4` is the default extraction model and is an Ollama model,
 * and reaching any other provider's client means reimplementing model-factory's
 * per-provider wiring here. Failing loudly is the honest alternative — an
 * operator who points `MEMORY_EXTRACTION_MODEL` elsewhere still gets enrichment
 * from the write path, which uses the factory.
 */
function buildExtractionModel() {
  const requested = process.env.MEMORY_EXTRACTION_MODEL ?? DEFAULT_EXTRACTION_MODEL;
  const modelConfig = AVAILABLE_MODELS.find(
    (candidate) => candidate.id === requested || candidate.model === requested,
  );
  if (!modelConfig) {
    throw new Error(`Unknown memory extraction model: ${requested}`);
  }
  if (modelConfig.provider !== "ollama") {
    throw new Error(
      `The sweep builds its own client and supports the ollama provider only; ` +
        `MEMORY_EXTRACTION_MODEL resolves to ${modelConfig.provider}. ` +
        `Leave it unset to use ${DEFAULT_EXTRACTION_MODEL}.`,
    );
  }

  const apiKey = process.env.OLLAMA_API_KEY;
  return new ChatOllama({
    model: modelConfig.model,
    baseUrl: process.env.OLLAMA_BASE_URL,
    // Ollama Cloud authenticates with a bearer token rather than an SDK
    // option, so the key travels as a header; a local daemon needs no auth.
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    temperature: 0,
    numPredict: modelConfig.maxOutput,
  });
}

/**
 * `null` on an outage, matching `embedOrNull` in the store: the sweep's job is
 * enrichment, and a memory it cannot embed is still a memory it can enrich —
 * its entities simply do not participate in the vector half of resolution.
 * A *width* mismatch is not an outage and does not return here; it throws,
 * because a vector that can never match the stored ones presents a broken
 * index as a working one.
 */
function buildEmbedder(): {
  client: AxiosInstance;
  model: string;
} | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_EMBEDDING_MODEL;
  if (!apiKey || !model) return null;
  return {
    model,
    client: axios.create({
      baseURL: "https://openrouter.ai/api/v1",
      timeout: OPENROUTER_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }),
  };
}

async function embedOrNull(
  embedder: ReturnType<typeof buildEmbedder>,
  text: string,
): Promise<number[] | null> {
  if (!embedder) return null;
  try {
    const response = await embedder.client.post("/embeddings", {
      model: embedder.model,
      input: text.trim() || ".",
    });
    const parsed = openRouterEmbeddingResponseSchema.safeParse(response.data);
    if (!parsed.success) return null;
    const vector = parsed.data.data[0].embedding;
    assertEmbeddingDimensions(vector, "enrich-memories");
    return vector;
  } catch (error) {
    // Checked before the degrade, not after: this is the one embedding failure
    // that must never be swallowed, and the `catch` above would otherwise turn
    // it into a null vector and hide an index that can never match.
    if (isEmbeddingDimensionError(error)) throw error;
    console.warn(
      `  embedding unavailable for "${text}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function statementRunner(tx: ManagedTransaction) {
  return async (cypher: string, params: Record<string, unknown>) => {
    const result = await tx.run(cypher, params);
    return result.records.map((record) => record.toObject());
  };
}

/** Entity embeddings, resolved before the write transaction opens. */
async function embedEntities(
  embedder: ReturnType<typeof buildEmbedder>,
  enrichment: Enrichment,
): Promise<Map<string, number[] | null>> {
  const embeddings = new Map<string, number[] | null>();
  for (const entity of enrichment.entities) {
    const key = entity.normalizedName;
    if (embeddings.has(key)) continue;
    embeddings.set(key, await embedOrNull(embedder, key));
  }
  return embeddings;
}

async function pendingNeighbours(
  session: Session,
  memory: { id: string; userId: string },
): Promise<ExtractionNeighbour[]> {
  const { records } = await session.executeRead((tx) =>
    tx.run(EDGE_CANDIDATE_CYPHER, {
      userId: memory.userId,
      id: memory.id,
      limit: MEMORY_EDGE_CANDIDATE_LIMIT,
    }),
  );
  return records.slice(0, MEMORY_EDGE_NEIGHBOR_LIMIT).map((record) => ({
    id: String(record.get("id")),
    content: (record.get("content") as string) ?? "",
  }));
}

async function enrichPendingMemories(options: { limit?: number } = {}) {
  const limit = options.limit ?? DEFAULT_ENRICH_LIMIT;
  const model = buildExtractionModel();
  const embedder = buildEmbedder();
  if (!embedder) {
    console.warn(
      "OPENROUTER_API_KEY or OPENROUTER_EMBEDDING_MODEL is unset; entities will\n" +
        "be written without vectors, so they will not merge with near-duplicates.",
    );
  }

  const session = driver.session();
  let enqueued = 0;
  let enriched = 0;
  let failed = 0;
  try {
    const { records } = await session.executeRead((tx) =>
      tx.run(ENRICH_PENDING_CYPHER, { limit }),
    );
    enqueued = records.length;

    for (const record of records) {
      const memory = {
        id: String(record.get("id")),
        userId: String(record.get("userId")),
        content: (record.get("content") as string) ?? "",
        vectorless: record.get("vectorless") === true,
      };

      try {
        const neighbours = await pendingNeighbours(session, memory);
        const enrichment = await extractEnrichment(
          model,
          memory.content,
          neighbours,
        );
        if (!enrichment) {
          console.warn(
            `  ${memory.id}: extraction failed validation; left pending`,
          );
          failed += 1;
          continue;
        }

        const entityEmbeddings = await embedEntities(embedder, enrichment);
        // The memory's own vector, in the same transaction as the enrichment.
        // Resolved out here for the reason every other embedding is: one HTTP
        // round trip is a long time to hold write locks.
        const embedding = memory.vectorless
          ? await embedOrNull(embedder, memory.content)
          : null;

        await session.executeWrite(async (tx) => {
          const run = statementRunner(tx);
          if (embedding) {
            await run(MEMORY_EMBEDDING_CYPHER, {
              id: memory.id,
              userId: memory.userId,
              embedding,
            });
          }
          await writeEnrichment(run, {
            memoryId: memory.id,
            userId: memory.userId,
            enrichment,
            entityEmbeddings,
          });
        });

        // The enrichment above is still worth keeping — the memory stays queued
        // either way, because `ENRICH_PENDING_CYPHER` matches on `embedding IS
        // NULL` as well as on `enrichedAt`. What must not happen is the sweep
        // calling this a success.
        if (
          classifyEnrichmentOutcome({
            vectorless: memory.vectorless,
            embedded: embedding !== null,
          }) === "failed"
        ) {
          console.warn(
            `  ${memory.id}: still vectorless; the embedding provider did not answer`,
          );
          failed += 1;
          continue;
        }

        enriched += 1;
      } catch (error) {
        console.warn(
          `  ${memory.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        failed += 1;
      }
    }
  } finally {
    await session.close();
  }

  return { enqueued, enriched, failed };
}

async function main(): Promise<void> {
  const rawLimit = process.env.ENRICH_LIMIT;
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_ENRICH_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error(`ENRICH_LIMIT must be a positive integer, got: ${rawLimit}`);
    process.exit(1);
  }

  try {
    const summary = await enrichPendingMemories({ limit });
    console.log(summary);
    if (summary.failed > 0) {
      console.error(
        `\n${summary.failed} memory(s) could not be enriched and remain pending.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error("memory enrichment sweep failed to run:", error);
  process.exit(1);
});
