import { MongoClient } from "mongodb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { Pool } from "pg";
import {
  CHAT_DOCUMENT_ATTRIBUTE,
  DELETE_CHUNKS_FOR_OWNER_SQL,
  INSERT_CHUNK_SQL,
} from "../constants/knowledge";
import { EMBEDDING_DIMENSIONS } from "../constants/embeddings";
import { chunkDocumentWithOverlap } from "../lib/knowledge/chunking";
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

const BATCH_LIMIT = Number(process.env.BACKFILL_LIMIT ?? 500);

interface DocumentRow {
  _id: string;
  userId: string;
  chatThreadId?: string;
  agentId?: string;
  name?: string;
  content?: string;
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
  const embeddings = new OllamaEmbeddings({
    model: process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text",
    baseUrl: process.env.OLLAMA_BASE_URL,
    ...(process.env.OLLAMA_API_KEY
      ? { headers: { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } }
      : {}),
    truncate: true,
    maxRetries: 3,
  });

  let indexed = 0;
  let cleared = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await mongo.connect();
    const documents = mongo
      .db(process.env.MONGODB_DB_NAME ?? "geniechat")
      .collection<DocumentRow>("documents");

    const cursor = documents
      .find({ type: CHAT_DOCUMENT_ATTRIBUTE, isDeleted: false })
      .limit(BATCH_LIMIT);

    for await (const document of cursor) {
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
            embedding = await embeddings.embedQuery(
              truncateByEstimatedTokenBudget(
                normalizeTextForEmbedding(content),
              ),
            );
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
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`Failed to index ${document._id}:`, error);
        failed += 1;
      } finally {
        client.release();
      }
    }
  } finally {
    await mongo.close();
    await pool.end();
  }

  console.log(
    `Backfill complete: ${indexed} chunks indexed, ${cleared} documents cleared, ${skipped} documents skipped, ${failed} failures.`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
