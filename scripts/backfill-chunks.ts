import { MongoClient, type Filter } from "mongodb";
import axios, { type AxiosInstance } from "axios";
import { z } from "zod";
import { Pool } from "pg";
import {
  DELETE_CHUNKS_FOR_OWNER_SQL,
  INSERT_CHUNK_SQL,
} from "../constants/knowledge";
import { EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "../constants/embeddings";
import { chunkDocumentWithOverlap } from "../lib/knowledge/chunking";
import {
  buildBackfillPageQuery,
  findIndexCountMismatches,
  type BackfilledDocument,
} from "../lib/knowledge/backfill";
import { generateId } from "../lib/utils";
import { toVectorLiteral } from "../lib/postgres/vector";
import {
  normalizeTextForEmbedding,
  truncateByEstimatedTokenBudget,
} from "../lib/embeddings/text";

/**
 * Re-chunks and re-embeds the documents already in MongoDB.
 *
 * The property that makes this safe to re-run: chunks are reproducible from
 * Mongo. `ChatDocument` stores the full extracted text, and
 * `chunkDocumentWithOverlap` is deterministic, so re-chunking stored extracts
 * reproduces boundaries without the original files or Garage access.
 *
 * The replace is scoped to the document being backfilled (`source_id`), not to
 * its owner. A thread holds chunks from every document uploaded to it, so an
 * owner-scoped delete would leave each thread with only its last document.
 */

/** Documents read per round trip. The migration reads to the end, a page at a time. */
const PAGE_SIZE = Number(process.env.BACKFILL_PAGE_SIZE ?? 200);

/**
 * An optional ceiling for a trial run. Unset is the normal case and means
 * "migrate everything"; when it truncates a run the script says so and names how
 * much was left, because a migration that stops early while reporting success is
 * the failure mode this file exists to avoid.
 */
const OVERALL_LIMIT = process.env.BACKFILL_LIMIT
  ? Number(process.env.BACKFILL_LIMIT)
  : null;

interface DocumentRow {
  _id: string;
  userId: string;
  chatThreadId?: string;
  agentId?: string;
  name?: string;
  content?: string;
  numberOfIndexes?: number;
}

function ownerOf(document: DocumentRow): {
  ownerType: "agent" | "chat";
  ownerId: string;
} | null {
  if (document.agentId) {
    return { ownerType: "agent", ownerId: document.agentId };
  }
  if (document.chatThreadId) {
    return { ownerType: "chat", ownerId: document.chatThreadId };
  }
  return null;
}

async function main(): Promise<void> {
  const postgresUrl = process.env.POSTGRES_URL;
  const mongoUri = process.env.MONGODB_URI;
  if (!postgresUrl || !mongoUri) {
    console.error("POSTGRES_URL and MONGODB_URI must both be set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: postgresUrl });
  const mongo = new MongoClient(mongoUri);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model =
    process.env.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  const openRouterClient: AxiosInstance = axios.create({
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 60_000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const embeddingDataSchema = z.object({
    embedding: z.array(z.number()),
  });
  const openRouterEmbeddingResponseSchema = z.object({
    data: z.array(embeddingDataSchema).min(1),
  });

  let indexed = 0;
  let cleared = 0;
  let skipped = 0;
  let failed = 0;
  let examined = 0;
  let total = 0;
  const backfilled: BackfilledDocument[] = [];

  try {
    await mongo.connect();
    const documents = mongo
      .db(process.env.MONGODB_DB_NAME ?? "geniechat")
      .collection<DocumentRow>("documents");

    total = await documents.countDocuments(
      buildBackfillPageQuery() as Filter<DocumentRow>,
    );

    // Paged to the end rather than capped at one batch. A single `limit()` on an
    // unsorted read stops early and still reports success, which is how a corpus
    // larger than the cap migrates silently and incompletely: re-runs read
    // roughly the same natural-order prefix, so the tail is never reached.
    let lastId: string | undefined;
    for (;;) {
      const page = await documents
        .find(buildBackfillPageQuery(lastId) as Filter<DocumentRow>)
        .sort({ _id: 1 })
        .limit(PAGE_SIZE)
        .toArray();

      if (page.length === 0) break;

      for (const document of page) {
        examined += 1;
        const owner = ownerOf(document);
        // The only thing worth skipping for: with no owner tuple there is nothing
        // to delete under and nothing to write to.
        if (!owner) {
          skipped += 1;
          continue;
        }

        // An empty extraction is not a skip. `indexChunks` treats zero chunks as a
        // valid clear, and this has to agree: a document whose extraction shrinks
        // to nothing on a re-parse must lose the chunks it had, not keep them
        // answering questions because there happened to be nothing to insert.
        const contents = chunkDocumentWithOverlap(document.content ?? "");
        if (contents.length === 0) cleared += 1;

        let documentChunks = 0;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Replace semantics, scoped to this document: it is what makes a re-run
          // safe without clearing the owner's other documents.
          await client.query(DELETE_CHUNKS_FOR_OWNER_SQL, [
            owner.ownerType,
            owner.ownerId,
            document._id,
          ]);

          for (let index = 0; index < contents.length; index += 1) {
            const content = contents[index];
            let embedding: number[] | null = null;
            try {
              const candidate = truncateByEstimatedTokenBudget(
                normalizeTextForEmbedding(content),
              );
              const textToEmbed = candidate.trim() || ".";
              const response = await openRouterClient.post("/embeddings", {
                model,
                input: textToEmbed,
              });
              const parsed = openRouterEmbeddingResponseSchema.parse(
                response.data,
              );
              embedding = parsed.data[0].embedding;
              if (embedding.length !== EMBEDDING_DIMENSIONS) {
                console.error(
                  `Embedding width ${embedding.length} != ${EMBEDDING_DIMENSIONS}; aborting.`,
                );
                await client.query("ROLLBACK");
                process.exit(1);
              }
            } catch (error) {
              console.error(`Embedding failed for ${document._id}:`, error);
              failed += 1;
            }

            await client.query(INSERT_CHUNK_SQL, [
              generateId(),
              owner.ownerType,
              owner.ownerId,
              document.userId,
              document._id,
              document.name ?? null,
              index,
              content,
              embedding ? toVectorLiteral(embedding) : null,
            ]);
            indexed += 1;
            documentChunks += 1;
          }

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          console.error(`Failed to index ${document._id}:`, error);
          failed += 1;
        } finally {
          client.release();
        }

        backfilled.push({
          id: document._id,
          name: document.name,
          indexed: documentChunks,
          recorded: document.numberOfIndexes,
        });
      }

      lastId = page[page.length - 1]._id;

      if (OVERALL_LIMIT !== null && examined >= OVERALL_LIMIT) {
        console.log(
          `Stopping at BACKFILL_LIMIT=${OVERALL_LIMIT}: ${Math.max(total - examined, 0)} document(s) left unmigrated. Unset it to migrate all of them.`,
        );
        break;
      }
    }
  } finally {
    await mongo.close();
    await pool.end();
  }

  console.log(
    `Backfill complete: ${indexed} chunks indexed across ${examined} of ${total} live documents ` +
      `(${cleared} with nothing to index, ${skipped} skipped for having no owner, ${failed} failures).`,
  );

  // The verification the design asks for: a document whose chunk count no longer
  // matches what was recorded for it is the only signal that the migration did
  // something other than what it claims.
  const mismatches = findIndexCountMismatches(backfilled);
  if (mismatches.length === 0) {
    console.log("Verified: every document's indexed chunk count matches its recorded count.");
  } else {
    console.log(
      `${mismatches.length} document(s) hold a different chunk count than recorded:`,
    );
    for (const mismatch of mismatches) {
      console.log(
        `  ${mismatch.id} (${mismatch.name ?? "unnamed"}): indexed ${mismatch.indexed}, recorded ${mismatch.recorded ?? "not recorded"}`,
      );
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
