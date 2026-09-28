import "server-only";
import { randomUUID } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import {
  MEMORY_EDGE_CANDIDATE_LIMIT,
  MEMORY_EDGE_NEIGHBOR_LIMIT,
  MEMORY_GRAPH_MEMORY_LIMIT,
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_TRAVERSABLE_TYPES,
  memorySeedLimit,
} from "@/constants/memory";
import { generateEmbedding } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getNeo4jDriver, isNeo4jConfigured } from "@/lib/neo4j/client";
import { buildDeterministicEdges, extractEntityNames } from "./extract";
import {
  EDGE_CANDIDATE_CYPHER,
  ENTITY_ABOUT_CYPHER,
  ENTITY_GC_CYPHER,
  EXPAND_CYPHER,
  GRAPH_ABOUT_CYPHER,
  GRAPH_ENTITY_RELATIONS_CYPHER,
  GRAPH_MEMORIES_CYPHER,
  GRAPH_MEMORY_COUNT_CYPHER,
  GRAPH_MEMORY_EDGES_CYPHER,
  MEMORY_DELETE_CYPHER,
  SEED_CYPHER,
} from "./cypher";
import { enrichMemory } from "./enrich";
import { writeEnrichment } from "./enrichment-write";
import type { Enrichment } from "./enrichment-schema";
import type { MemoryGraphRows } from "./graph-view";
import type { ExtractionNeighbour } from "./llm-extraction";
import { mergeRecallCandidates, rankRecall } from "./recall";
import { normalizeQueryForRetrieval } from "./text";
import { buildMemoryUpdateSet } from "./update";
import type { GraphRAGMemorySearchResult, Memory, MemoryMode } from "./types";

interface MemoryNode {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  userName?: string | null;
  userEmail?: string | null;
  enrichedAt?: string | null;
}

function nodeToMemory(node: MemoryNode): Memory {
  return {
    id: node.id,
    userId: node.userId,
    // Required on `Memory`, nullable on the node — a memory written before the
    // caller knew the user's name stores null, and "" is the closest truthful
    // reading of that at this boundary.
    userName: node.userName ?? "",
    userEmail: node.userEmail ?? "",
    content: node.content,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    enrichedAt: node.enrichedAt ?? null,
  };
}

/**
 * Everything the deterministic pass needs, computed before the write transaction
 * opens. Splitting it out is not tidiness: the entity embeddings are HTTP calls
 * to the embedding provider, and holding a write transaction's locks across one
 * round trip per entity name is the same mistake the knowledge index avoids by
 * embedding outside its transaction.
 */
interface PreparedEntity {
  normalizedName: string;
  name: string;
  embedding: number[] | null;
}

interface PreparedEdge {
  id: string;
  score: number;
}

interface PreparedGraph {
  entities: PreparedEntity[];
  edges: PreparedEdge[];
  /**
   * The bounded front of the same candidate window the edges were scored from,
   * handed to the enrichment pass so it is not a second read. Bounded by
   * `MEMORY_EDGE_NEIGHBOR_LIMIT` rather than the whole window: the window is
   * 200 memories, and a prompt carrying 200 of them would swamp the one being
   * enriched and cost more per write than the write is worth.
   */
  neighbours: ExtractionNeighbour[];
}

/** Never throws on an outage: a memory without a vector is still a memory. */
async function embedOrNull(text: string, context: string): Promise<number[] | null> {
  try {
    return await generateEmbedding(text);
  } catch (error) {
    logger.error({ err: error, context }, "Embedding unavailable; writing without a vector");
    return null;
  }
}

/** The columns both recall queries return, read the same way. */
function rowToRecallFields(record: Record<string, unknown>) {
  return {
    id: String(record.id ?? ""),
    content: String(record.content ?? ""),
    userName: String(record.userName ?? ""),
    userEmail: String(record.userEmail ?? ""),
    createdAt: String(record.createdAt ?? ""),
    updatedAt: String(record.updatedAt ?? ""),
  };
}

export class MemoryGraphStore {
  private async requireDriver() {
    if (!isNeo4jConfigured()) {
      // Memories are the feature. Silently returning "you have no memories"
      // would be a lie, so an unconfigured store is an error.
      throw new Error("Neo4j is not configured; memory storage is unavailable");
    }
    return getNeo4jDriver();
  }

  async createMemory(
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt">,
  ): Promise<Memory> {
    const driver = await this.requireDriver();
    const now = new Date().toISOString();
    const id = randomUUID();
    const content = memory.content ?? "";

    const embedding = await embedOrNull(content, "createMemory");
    const prepared = await this.prepareDeterministicGraph({ id, userId: memory.userId, content });

    const session = driver.session();
    try {
      await session.executeWrite(async (tx) => {
        // MERGE on the id constraint makes a retry a no-op rather than a duplicate.
        await tx.run(
          `MERGE (m:Memory {id: $id})
           SET m.userId = $userId,
               m.content = $content,
               m.createdAt = $createdAt,
               m.updatedAt = $updatedAt,
               m.userName = $userName,
               m.userEmail = $userEmail,
               m.embedding = $embedding,
               m.enrichedAt = null`,
          {
            id,
            userId: memory.userId,
            content,
            createdAt: now,
            updatedAt: now,
            userName: memory.userName ?? null,
            userEmail: memory.userEmail ?? null,
            embedding,
          },
        );
        await this.writeDeterministicGraph(tx, { id, userId: memory.userId }, prepared);
      });
    } finally {
      await session.close();
    }

    // Detached on purpose: the memory is already saved and enrichment only adds
    // edges, so a chat turn must not wait on a model to store a preference. A
    // failure leaves `enrichedAt` null, which is the state `pnpm memory:enrich`
    // sweeps up. `enrichMemory` resolves rather than rejecting; the catch is
    // there so that a bug inside it cannot become an unhandled rejection.
    void enrichMemory(this, id, memory.userId, content, prepared.neighbours).catch(
      (error) => logger.error({ err: error, id }, "Background enrichment failed"),
    );

    return {
      ...memory,
      id,
      createdAt: now,
      updatedAt: now,
      enrichedAt: null,
    };
  }

  /**
   * Entities by MERGE on the (userId, normalizedName) constraint, then ABOUT
   * edges, then RELATES_TO to the nearest existing memories. Entity upserts and
   * edge writes are all index-backed MERGEs, so per-write cost is proportional
   * to this memory's entity count, not to the corpus.
   */
  private async writeDeterministicGraph(
    tx: ManagedTransaction,
    memory: { id: string; userId: string },
    prepared: PreparedGraph,
  ): Promise<void> {
    const now = new Date().toISOString();

    for (const entity of prepared.entities) {
      // `extractEntityNames` already guarantees a non-empty name and
      // `normalizeEntityName` is what guarantees it; the guard is repeated here
      // because an empty name would MERGE one node shared by every user, which
      // is unrecoverable.
      if (!entity.normalizedName) continue;
      await tx.run(ENTITY_ABOUT_CYPHER, {
        id: memory.id,
        userId: memory.userId,
        normalizedName: entity.normalizedName,
        entityId: randomUUID(),
        name: entity.name,
        now,
        embedding: entity.embedding,
      });
    }

    if (prepared.edges.length === 0) return;
    await tx.run(
      `MATCH (m:Memory {id: $id, userId: $userId})
       UNWIND $edges AS edge
       MATCH (other:Memory {id: edge.id, userId: $userId})
       MERGE (m)-[r:RELATES_TO]->(other)
         ON CREATE SET r.weight = edge.score, r.createdAt = $now`,
      { id: memory.id, userId: memory.userId, edges: prepared.edges, now },
    );
  }

  /** The read half of `writeDeterministicGraph`, safe to call outside a transaction. */
  private async prepareDeterministicGraph(memory: {
    id: string;
    userId: string;
    content: string;
  }): Promise<PreparedGraph> {
    const entities: PreparedEntity[] = [];
    for (const name of extractEntityNames(memory.content)) {
      if (!name) continue;
      entities.push({
        normalizedName: name,
        name,
        embedding: await embedOrNull(name, "entity"),
      });
    }

    const driver = await this.requireDriver();
    const session = driver.session();
    try {
      const { records } = await session.executeRead((tx) =>
        // Ordered, so the candidate window is a stable recent slice rather
        // than an arbitrary one — see MEMORY_EDGE_CANDIDATE_LIMIT. The statement
        // lives in cypher.ts so scripts/check-memory.ts executes the same one.
        tx.run(EDGE_CANDIDATE_CYPHER, {
          userId: memory.userId,
          id: memory.id,
          limit: MEMORY_EDGE_CANDIDATE_LIMIT,
        }),
      );

      const candidates = records.map((record) => ({
        id: record.get("id") as string,
        content: (record.get("content") as string) ?? "",
      }));
      const edges = buildDeterministicEdges(
        { id: memory.id, content: memory.content },
        candidates,
      );
      return {
        entities,
        edges,
        neighbours: candidates.slice(0, MEMORY_EDGE_NEIGHBOR_LIMIT),
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Drops this memory's outgoing derived edges so they can be re-derived from
   * new content. Incoming `RELATES_TO` from other memories is left alone: those
   * edges were scored from *their* content, and removing them would be one write
   * reaching into another memory's derivation.
   */
  private async clearDerivedEdges(
    tx: ManagedTransaction,
    memoryId: string,
    userId: string,
  ): Promise<void> {
    await tx.run(
      `MATCH (m:Memory {id: $id, userId: $userId})-[r:ABOUT|RELATES_TO]->()
       DELETE r`,
      { id: memoryId, userId },
    );
  }

  /**
   * Without this, entities accumulate forever: a leak this design would
   * otherwise introduce. Scoped by userId, which is indexed.
   */
  private async garbageCollectOrphanEntities(
    tx: ManagedTransaction,
    userId: string,
  ): Promise<void> {
    await tx.run(ENTITY_GC_CYPHER, { userId });
  }

  async getMemories(userId: string): Promise<Memory[]> {
    const driver = await this.requireDriver();
    const session = driver.session();
    try {
      const { records } = await session.executeRead((tx) =>
        tx.run(
          `MATCH (m:Memory {userId: $userId})
           RETURN m ORDER BY m.createdAt DESC`,
          { userId },
        ),
      );
      return records.map((record) => nodeToMemory(record.get("m").properties as MemoryNode));
    } finally {
      await session.close();
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

  async getMemory(memoryId: string, userId: string): Promise<Memory | null> {
    const driver = await this.requireDriver();
    const session = driver.session();
    try {
      const { records } = await session.executeRead((tx) =>
        tx.run(`MATCH (m:Memory {id: $id, userId: $userId}) RETURN m`, {
          id: memoryId,
          userId,
        }),
      );
      const record = records[0];
      return record ? nodeToMemory(record.get("m").properties as MemoryNode) : null;
    } finally {
      await session.close();
    }
  }

  /**
   * The ownership check and the write are one statement, so the
   * read-then-write race the Mongo store had cannot happen, and a caller who
   * does not own the memory matches nothing.
   *
   * A content change re-derives everything derived from content: the embedding
   * and the deterministic graph. Leaving either behind would make the memory
   * match text it no longer contains — the vector by similarity, the entities by
   * `ABOUT`. Both are computed before the transaction opens, for the reason
   * `PreparedGraph` gives.
   */
  async updateMemory(
    memoryId: string,
    userId: string,
    updates: Partial<Memory>,
  ): Promise<Memory | null> {
    const driver = await this.requireDriver();
    const set = buildMemoryUpdateSet(updates);
    const contentChanged = updates.content !== undefined;
    const content = updates.content ?? "";

    const embedding = contentChanged ? await embedOrNull(content, "updateMemory") : null;
    const prepared = contentChanged
      ? await this.prepareDeterministicGraph({ id: memoryId, userId, content })
      : null;

    const properties: Record<string, unknown> = {
      ...set,
      updatedAt: new Date().toISOString(),
    };
    // Only on a content change, and assigned rather than coalesced: when the
    // provider is down this writes a null vector and the memory degrades to the
    // lexical arm (§8). Keeping the previous vector would be worse than having
    // none, because it would describe text the memory no longer holds.
    if (contentChanged) properties.embedding = embedding;
    // The LLM's edges were judged against the old content, and its RELATES_TO
    // edges share a type with the deterministic ones this write re-derives —
    // so they go with them. Clearing the marker is what re-enqueues the memory:
    // "enriched" is a claim about a specific text, and this is no longer it.
    if (contentChanged) properties.enrichedAt = null;

    const session = driver.session();
    try {
      const { records } = await session.executeWrite(async (tx) => {
        const result = await tx.run(
          `MATCH (m:Memory {id: $id, userId: $userId})
           SET m += $properties
           RETURN m`,
          { id: memoryId, userId, properties },
        );
        // Nothing matched: not this user's memory, or no such memory. The
        // derived work above is wasted, but the check cannot move earlier
        // without reintroducing the read-then-write race it exists to remove.
        if (result.records.length === 0 || !prepared) return result;

        await this.clearDerivedEdges(tx, memoryId, userId);
        await this.writeDeterministicGraph(tx, { id: memoryId, userId }, prepared);
        await this.garbageCollectOrphanEntities(tx, userId);
        return result;
      });
      const record = records[0];
      return record ? nodeToMemory(record.get("m").properties as MemoryNode) : null;
    } finally {
      await session.close();
    }
  }

  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    const driver = await this.requireDriver();
    const session = driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        const result = await tx.run(MEMORY_DELETE_CYPHER, { id: memoryId, userId });
        if (result.summary.counters.updates().nodesDeleted === 0) return false;

        await this.garbageCollectOrphanEntities(tx, userId);
        return true;
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Writes one validated extraction: resolved entities and their `ABOUT` edges,
   * entity relations, the model's own memory→memory edges, then the
   * `enrichedAt` marker. The orchestration lives in `enrichment-write.ts` — it
   * is driver-free, so `scripts/check-memory.ts` runs the same code against the
   * same statements rather than a copy of them.
   */
  async applyEnrichment(
    memoryId: string,
    userId: string,
    enrichment: Enrichment,
  ): Promise<void> {
    const driver = await this.requireDriver();

    // Before the transaction opens, for the reason `PreparedEntity` gives: one
    // HTTP round trip per entity is a long time to hold write locks. The
    // *normalized* name is embedded, matching what the deterministic pass puts
    // in the entity index — two writers leaving incomparable vectors for the
    // same concept would defeat resolution step 2.
    const entityEmbeddings = new Map<string, number[] | null>();
    for (const entity of enrichment.entities) {
      if (entityEmbeddings.has(entity.normalizedName)) continue;
      entityEmbeddings.set(
        entity.normalizedName,
        await embedOrNull(entity.normalizedName, "enrichment entity"),
      );
    }

    const session = driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await writeEnrichment(
          async (cypher, params) => {
            const result = await tx.run(cypher, params);
            return result.records.map((record) => record.toObject());
          },
          { memoryId, userId, enrichment, entityEmbeddings },
        );
      });
    } finally {
      await session.close();
    }
  }

  async searchRelevantMemories(
    userId: string,
    query: string,
    top = 5,
  ): Promise<Memory[]> {
    const result = await this.searchRelevantMemoriesWithGraph(userId, query, top);
    return result.memories;
  }

  async searchRelevantMemoriesWithGraph(
    userId: string,
    query: string,
    top = 5,
  ): Promise<GraphRAGMemorySearchResult> {
    const normalized = normalizeQueryForRetrieval(query);
    const empty = (mode: MemoryMode): GraphRAGMemorySearchResult => ({
      memories: [],
      metadata: {
        mode,
        semanticSeedCount: 0,
        lexicalSeedCount: 0,
        graphExpandedCount: 0,
        totalCandidates: 0,
      },
    });

    if (!normalized) return empty("graph");

    // Spec §8: with no `NEO4J_URI`, retrieval returns empty and logs. This guard
    // is the whole of that promise — `requireDriver` throws, and it is called
    // outside every `try` below, so before this an unconfigured deployment threw
    // out of each chat turn instead of quietly remembering nothing. CRUD still
    // throws, deliberately: "I remember nothing about that" is an honest answer
    // when the graph is gone, and a write that only appears to succeed is not.
    if (!isNeo4jConfigured()) {
      logger.error({ userId }, "Graph memory recall skipped; Neo4j is not configured");
      return empty("graph");
    }

    const driver = await this.requireDriver();
    const seedLimit = memorySeedLimit(top);

    // A query too long to embed leaves the vector arm empty; there is no
    // lexical fallback in the graph, so the result is empty rather than wrong.
    let queryVector: number[] | null = null;
    try {
      queryVector = await generateEmbedding(normalized);
    } catch (error) {
      logger.error({ err: error, userId }, "Query embedding failed; no vector seeds");
    }
    if (!queryVector) return empty("vector");

    const session = driver.session();
    try {
      const seeds = await session.executeRead(async (tx) => {
        const { records } = await tx.run(SEED_CYPHER, {
          queryVector,
          userId,
          k: seedLimit,
        });
        return records.map((record) => ({
          ...rowToRecallFields(record.toObject()),
          vectorScore: Number(record.get("vectorScore")),
          hops: 0,
          pathWeight: 1,
        }));
      });

      if (seeds.length === 0) return empty("graph");

      const expanded = await session.executeRead(async (tx) => {
        const { records } = await tx.run(EXPAND_CYPHER, {
          seedIds: seeds.map((seed) => seed.id),
          userId,
          allowedTypes: MEMORY_TRAVERSABLE_TYPES,
          expansionLimit: seedLimit * 2,
        });
        return records.map((record) => ({
          ...rowToRecallFields(record.toObject()),
          vectorScore: 0,
          hops: Number(record.get("hops")),
          pathWeight: Number(record.get("pathWeight")),
        }));
      });

      const merged = mergeRecallCandidates(seeds, expanded);
      const ranked = rankRecall(merged.candidates, { top });
      logger.info(
        {
          userId,
          seedCount: seeds.length,
          expandedCount: merged.addedCount,
          returned: ranked.length,
        },
        "Graph memory recall complete",
      );

      return {
        memories: ranked.map((candidate) => ({
          id: candidate.id,
          userId,
          userName: candidate.userName,
          userEmail: candidate.userEmail,
          content: candidate.content,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
          enrichedAt: null,
        })),
        metadata: {
          mode: "graph",
          semanticSeedCount: seeds.length,
          lexicalSeedCount: 0,
          graphExpandedCount: merged.addedCount,
          totalCandidates: merged.candidates.length,
        },
      };
    } catch (error) {
      // Never slice, never fabricate: an error means no memories, not the
      // first `top` rows of the corpus.
      logger.error({ err: error, userId }, "Graph memory recall failed");
      return empty("vector");
    } finally {
      await session.close();
    }
  }
}
