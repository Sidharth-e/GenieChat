import { MongoClient } from "mongodb";
import neo4j from "neo4j-driver";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { MEMORY_EDGE_CANDIDATE_LIMIT } from "@/constants/memory";
import {
  ENTITY_ABOUT_CYPHER,
  EDGE_CANDIDATE_CYPHER,
  MIGRATE_MEMORY_CYPHER,
} from "@/lib/memory/cypher";
import { assertEmbeddingDimensions } from "@/lib/embeddings/dimensions";
import {
  buildDeterministicEdges,
  extractEntityNames,
  type ScorableMemory,
} from "@/lib/memory/extract";
import { normalizeMemoryCategory } from "@/lib/memory/update";
import { generateId } from "@/lib/utils";

/**
 * Moves the `memories` collection from MongoDB into the Neo4j graph — the one
 * write in this migration, and the last time the collection is read.
 *
 * Four deliberate choices:
 *
 * 1. It reads `process.env` directly and drives both drivers itself, for the
 *    reason every other script here does: `lib/config` is `server-only`, and
 *    that guard does not resolve under `tsx`, so neither the store nor
 *    `lib/embeddings` is reachable.
 * 2. Every vector is regenerated from `content` rather than copied. The stored
 *    vectors are the width of a model this database no longer uses, so they are
 *    unreadable by the current one — and `content` is stored, which is why
 *    discarding them costs nothing.
 * 3. Nodes are written first and edges second, in two passes. `RELATES_TO` is
 *    scored against *other* memories, so a single pass would score each memory
 *    against whichever subset happened to be migrated already, and edge count
 *    would depend on document order.
 * 4. It is safe to re-run. `MERGE` is keyed on the `id` constraint, so a second
 *    run rewrites the same nodes rather than adding new ones.
 *
 * `enrichedAt` is deliberately left null: the LLM pass is `pnpm memory:enrich`,
 * which selects on exactly that.
 */

interface SourceMemory {
  _id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  content?: string;
  category?: string;
  createdAt?: string;
  updatedAt?: string;
}

const HINT = "`memory:migrate` loads `.env` for you.";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must be set. ${HINT}`);
    process.exit(1);
  }
  return value;
}

const mongoUri = requiredEnv("MONGODB_URI");
const neo4jUri = requiredEnv("NEO4J_URI");
const neo4jPassword = requiredEnv("NEO4J_PASSWORD");
const neo4jUser = process.env.NEO4J_USER ?? "neo4j";

const openRouterEmbeddingResponseSchema = z.object({
  data: z
    .array(z.object({ embedding: z.array(z.number()) }).passthrough())
    .min(1),
});

const embeddingModel = process.env.OPENROUTER_EMBEDDING_MODEL;
const embeddingKey = process.env.OPENROUTER_API_KEY;

if (!embeddingModel || !embeddingKey) {
  // Not a degrade-to-null case, unlike the enrichment sweep: this script's whole
  // purpose is to carry the vectors across, and a migration that silently wrote
  // vectorless memories would leave the lexical arm as the only retrieval path
  // with nothing saying so.
  console.error(
    "OPENROUTER_API_KEY and OPENROUTER_EMBEDDING_MODEL must both be set; every\n" +
      "memory is re-embedded during the migration.",
  );
  process.exit(1);
}

const embedder: AxiosInstance = axios.create({
  baseURL: "https://openrouter.ai/api/v1",
  timeout: 60_000,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${embeddingKey}`,
  },
});

async function embed(text: string): Promise<number[]> {
  const response = await embedder.post("/embeddings", {
    model: embeddingModel,
    input: text.trim() || ".",
  });
  const parsed = openRouterEmbeddingResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Unexpected embedding response: ${parsed.error.message}`);
  }
  const vector = parsed.data.data[0].embedding;
  // A width mismatch is not an outage and must not be papered over: it means the
  // index and the model disagree, and every vector written here would be
  // unreadable by every query.
  assertEmbeddingDimensions(vector, "migrate-memories");
  return vector;
}

async function main(): Promise<void> {
  const rawLimit = process.env.MIGRATE_LIMIT;
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 0;
  if (rawLimit && (!Number.isInteger(limit) || limit <= 0)) {
    console.error(`MIGRATE_LIMIT must be a positive integer, got: ${rawLimit}`);
    process.exit(1);
  }

  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
    { disableLosslessIntegers: true },
  );

  const summary = {
    documents: 0,
    merged: 0,
    embedded: 0,
    entities: 0,
    edges: 0,
    failed: 0,
  };

  const session = driver.session();
  try {
    const source = mongo.db(process.env.MONGODB_DB_NAME || "geniechat");
    const cursor = source.collection<SourceMemory>("memories").find({ type: "memory" });
    if (limit > 0) cursor.limit(limit);
    const documents = await cursor.toArray();
    summary.documents = documents.length;

    // Pass one: the memories themselves, and the entities they name.
    const migrated: {
      id: string;
      userId: string;
      content: string;
      category?: string;
    }[] = [];
    for (const document of documents) {
      const id = String(document._id);
      const userId = document.userId;
      if (!userId) {
        console.warn(`  ${id}: no userId; skipped`);
        summary.failed += 1;
        continue;
      }

      const content = document.content ?? "";
      try {
        const embedding = await embed(content);

        await session.executeWrite(async (tx) => {
          await tx.run(
            MIGRATE_MEMORY_CYPHER,
            {
              id,
              userId,
              userName: document.userName ?? null,
              userEmail: document.userEmail ?? null,
              content,
              category: normalizeMemoryCategory(document.category) ?? null,
              // Preserved, not re-stamped: these are the dates the memories were
              // actually written, and `relationScore` reads `createdAt`.
              createdAt: document.createdAt ?? new Date().toISOString(),
              updatedAt: document.updatedAt ?? new Date().toISOString(),
              embedding,
            },
          );

          for (const name of extractEntityNames(content)) {
            if (!name) continue;
            await tx.run(ENTITY_ABOUT_CYPHER, {
              id,
              userId,
              normalizedName: name,
              entityId: generateId(),
              name,
              now: new Date().toISOString(),
              // Entities are embedded by the enrichment pass, which owns the
              // vector half of resolution; the deterministic pass in the store
              // does embed them, and this is the one place the migration is
              // deliberately thinner than a live write.
              embedding: null,
            });
            summary.entities += 1;
          }
        });

        summary.merged += 1;
        summary.embedded += 1;
        migrated.push({
          id,
          userId,
          content,
          category: normalizeMemoryCategory(document.category),
        });
      } catch (error) {
        console.warn(
          `  ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        summary.failed += 1;
      }
    }

    // Pass two: edges, now that every memory is present. The candidate statement
    // is the same bounded, ordered, newest-first window the store reads, so the
    // migrated graph and a live write see the same slice.
    for (const memory of migrated) {
      try {
        const { records } = await session.executeRead((tx) =>
          tx.run(EDGE_CANDIDATE_CYPHER, {
            userId: memory.userId,
            id: memory.id,
            limit: MEMORY_EDGE_CANDIDATE_LIMIT,
          }),
        );
        // Annotated, not inferred: `buildDeterministicEdges` unifies its two
        // arguments into one type, so an inferred candidate shape would make
        // the memory's own `category` an excess property.
        const candidates: (ScorableMemory & { id: string })[] = records.map(
          (record) => ({
            id: String(record.get("id")),
            content: (record.get("content") as string) ?? "",
          }),
        );
        const edges = buildDeterministicEdges(
          { id: memory.id, content: memory.content, category: normalizeMemoryCategory(memory.category) },
          candidates,
        );
        if (edges.length === 0) continue;

        await session.executeWrite(async (tx) => {
          await tx.run(
            `MATCH (m:Memory {id: $id, userId: $userId})
             UNWIND $edges AS edge
             MATCH (other:Memory {id: edge.id, userId: $userId})
             MERGE (m)-[r:RELATES_TO]->(other)
               ON CREATE SET r.weight = edge.score, r.createdAt = $now`,
            {
              id: memory.id,
              userId: memory.userId,
              edges,
              now: new Date().toISOString(),
            },
          );
        });
        summary.edges += edges.length;
      } catch (error) {
        console.warn(
          `  ${memory.id} (edges): ${error instanceof Error ? error.message : String(error)}`,
        );
        summary.failed += 1;
      }
    }
  } finally {
    await session.close();
    await driver.close();
    await mongo.close();
  }

  console.log(summary);
  if (summary.failed > 0) {
    console.error(`\n${summary.failed} document(s) failed to migrate.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("memory migration failed to run:", error);
  process.exit(1);
});
