import "server-only";
import { randomUUID } from "node:crypto";
import { MEMORY_GRAPH_MEMORY_LIMIT, MEMORY_LLM_EDGE_TYPES } from "@/constants/memory";
import { generateEmbedding, isEmbeddingDimensionError } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getNeo4jDriver, isNeo4jConfigured } from "@/lib/neo4j/client";
import {
  CAPTURE_CREATE_CYPHER,
  GRAPH_ABOUT_CYPHER,
  GRAPH_ENTITY_RELATIONS_CYPHER,
  GRAPH_MEMORIES_CYPHER,
  GRAPH_MEMORY_COUNT_CYPHER,
  GRAPH_MEMORY_EDGES_CYPHER,
  USER_UPSERT_CYPHER,
} from "./cypher";
import type { MemoryGraphRows } from "./graph-view";

export class MemoryGraphStore {
  private async requireDriver() {
    if (!isNeo4jConfigured()) {
      // Memories are the feature. Silently returning "you have no memories"
      // would be a lie, so an unconfigured store is an error.
      throw new Error("Neo4j is not configured; memory storage is unavailable");
    }
    return getNeo4jDriver();
  }

  /**
   * Stage a sentence. Synchronous, durable, and cheap: two index-backed writes
   * and one embed call, with no model in the path.
   *
   * The node is written **before** this returns, which is what makes the tool's
   * "Memory saved" honest — a process that dies a millisecond later leaves the
   * sentence on disk for the sweep. A call with no node behind it would make the
   * message a lie.
   *
   * An embedding outage stores the capture vectorless: a sentence with no vector
   * is still a sentence, and `CAPTURE_SEED_CYPHER` simply will not find it until
   * the sweep fills the vector in. A width mismatch is different — it rethrows,
   * because an index built at the wrong width can never match anything and
   * pretending otherwise presents a broken index as a working one.
   */
  async captureSentence(input: {
    userId: string;
    userName: string;
    userEmail: string;
    text: string;
  }): Promise<{ id: string }> {
    const text = input.text.trim();
    if (text === "") {
      throw new Error("Cannot capture an empty memory");
    }

    const embedding = await this.embedOrThrowOnMismatch(text, "memory capture");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const driver = await this.requireDriver();

    await driver.executeQuery(USER_UPSERT_CYPHER, {
      userId: input.userId,
      name: input.userName,
      email: input.userEmail,
    });

    await driver.executeQuery(CAPTURE_CREATE_CYPHER, {
      id,
      userId: input.userId,
      text,
      embedding,
      createdAt,
    });

    return { id };
  }

  /**
   * An embedding outage yields null; a width mismatch throws.
   *
   * A missing vector is a gap recall can heal later. A vector at the wrong width
   * can never match the index it is written to, so storing one would present a
   * broken index as a working one.
   */
  private async embedOrThrowOnMismatch(
    text: string,
    context: string,
  ): Promise<number[] | null> {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      if (isEmbeddingDimensionError(error)) throw error;
      logger.warn({ err: error }, `Embedding unavailable for ${context}`);
      return null;
    }
  }

  /**
   * The graph view's read: the drawn window, its edges, and the true total.
   *
   * Four statements in one session rather than one query, because the window has
   * to be chosen *before* the edges are read — `GRAPH_MEMORIES_CYPHER` decides
   * which memories exist for this view, and the edges are then scoped to that id
   * set. A single pattern would return edges to memories the window excluded,
   * which the view can only drop (making the picture disagree with the degrees
   * it reports) or draw as an orphan.
   *
   * Deliberately not a transaction: this is a read, the window cannot change
   * under it in any way the reader would notice, and `executeRead` per statement
   * keeps each one's retry behaviour to the statement that failed.
   */
  async getMemoryGraph(
    userId: string,
    memoryLimit: number = MEMORY_GRAPH_MEMORY_LIMIT,
  ): Promise<{ rows: MemoryGraphRows; totalMemories: number }> {
    const driver = await this.requireDriver();
    const session = driver.session();
    try {
      const memoryRows = await session.executeRead(async (tx) => {
        const { records } = await tx.run(GRAPH_MEMORIES_CYPHER, {
          userId,
          limit: memoryLimit,
        });
        return records.map((record) => ({
          id: String(record.get("id") ?? ""),
          content: String(record.get("content") ?? ""),
          createdAt: String(record.get("createdAt") ?? ""),
        }));
      });

      const totalMemories = await session.executeRead(async (tx) => {
        const { records } = await tx.run(GRAPH_MEMORY_COUNT_CYPHER, { userId });
        return Number(records[0]?.get("total") ?? 0);
      });

      const memoryIds = memoryRows.map((row) => row.id);
      // Nothing to attach edges to, and `IN []` is a wasted round trip each.
      if (memoryIds.length === 0) {
        return {
          rows: { memories: [], about: [], memoryEdges: [], entityRelations: [] },
          totalMemories,
        };
      }

      const about = await session.executeRead(async (tx) => {
        const { records } = await tx.run(GRAPH_ABOUT_CYPHER, { userId, memoryIds });
        return records.map((record) => ({
          memoryId: String(record.get("memoryId") ?? ""),
          entityId: String(record.get("entityId") ?? ""),
          entityName: record.get("entityName") as string | null,
          normalizedName: record.get("normalizedName") as string | null,
        }));
      });

      const memoryEdges = await session.executeRead(async (tx) => {
        const { records } = await tx.run(GRAPH_MEMORY_EDGES_CYPHER, {
          userId,
          memoryIds,
          // From the same constant `buildMemoryEdgeCypher` guards with, so a type
          // the writer may not create is also not one the reader asks for.
          edgeTypes: [...MEMORY_LLM_EDGE_TYPES],
        });
        return records.map((record) => ({
          source: String(record.get("source") ?? ""),
          target: String(record.get("target") ?? ""),
          type: String(record.get("type") ?? ""),
          weight: record.get("weight") as number | null,
          reason: record.get("reason") as string | null,
        }));
      });

      // Read from the ABOUT rows rather than from a full entity scan: the
      // relations that matter are the ones between entities this window drew.
      const entityIds = [...new Set(about.map((row) => row.entityId))];
      const entityRelations =
        entityIds.length === 0
          ? []
          : await session.executeRead(async (tx) => {
              const { records } = await tx.run(GRAPH_ENTITY_RELATIONS_CYPHER, {
                userId,
                entityIds,
              });
              return records.map((record) => ({
                source: String(record.get("source") ?? ""),
                target: String(record.get("target") ?? ""),
                relationType: record.get("relationType") as string | null,
              }));
            });

      return {
        rows: { memories: memoryRows, about, memoryEdges, entityRelations },
        totalMemories,
      };
    } finally {
      await session.close();
    }
  }
}
