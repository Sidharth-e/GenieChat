import "server-only";
import { randomUUID } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import { MEMORY_EDGE_CANDIDATE_LIMIT } from "@/constants/memory";
import { generateEmbedding } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getNeo4jDriver, isNeo4jConfigured } from "@/lib/neo4j/client";
import { buildDeterministicEdges, extractEntityNames } from "./extract";
import { buildMemoryUpdateSet } from "./update";
import type { Memory } from "./types";

interface MemoryNode {
  id: string;
  userId: string;
  content: string;
  category: string;
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
    category: (node.category ?? "other") as Memory["category"],
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
               m.category = $category,
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
            category: memory.category,
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

    return { ...memory, id, createdAt: now, updatedAt: now, enrichedAt: null };
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
      await tx.run(
        `MATCH (m:Memory {id: $id, userId: $userId})
         MERGE (e:Entity {userId: $userId, normalizedName: $normalizedName})
           ON CREATE SET e.id = $entityId,
                         e.name = $name,
                         e.createdAt = $now,
                         e.embedding = $embedding
         MERGE (m)-[:ABOUT]->(e)`,
        {
          id: memory.id,
          userId: memory.userId,
          normalizedName: entity.normalizedName,
          entityId: randomUUID(),
          name: entity.name,
          now,
          embedding: entity.embedding,
        },
      );
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
        tx.run(
          // Ordered, so the candidate window is a stable recent slice rather
          // than an arbitrary one — see MEMORY_EDGE_CANDIDATE_LIMIT.
          `MATCH (other:Memory {userId: $userId})
           WHERE other.id <> $id
           RETURN other.id AS id, other.content AS content
           ORDER BY other.createdAt DESC
           LIMIT $limit`,
          { userId: memory.userId, id: memory.id, limit: MEMORY_EDGE_CANDIDATE_LIMIT },
        ),
      );

      const edges = buildDeterministicEdges(
        { id: memory.id, content: memory.content },
        records.map((record) => ({
          id: record.get("id") as string,
          content: (record.get("content") as string) ?? "",
        })),
      );
      return { entities, edges };
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
    await tx.run(
      `MATCH (e:Entity {userId: $userId})
       WHERE NOT (e)<-[:ABOUT]-(:Memory)
       DETACH DELETE e`,
      { userId },
    );
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
        const result = await tx.run(
          `MATCH (m:Memory {id: $id, userId: $userId}) DETACH DELETE m`,
          { id: memoryId, userId },
        );
        if (result.summary.counters.updates().nodesDeleted === 0) return false;

        await this.garbageCollectOrphanEntities(tx, userId);
        return true;
      });
    } finally {
      await session.close();
    }
  }
}
