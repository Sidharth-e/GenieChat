import "server-only";
import { randomUUID } from "node:crypto";
import {
  MEMORY_CAPTURE_MAX_ATTEMPTS,
  MEMORY_CAPTURE_SEED_LIMIT,
  MEMORY_CAPTURE_SWEEP_LIMIT,
  MEMORY_ENTITY_MERGE_THRESHOLD,
  MEMORY_FACT_PAGE_SIZE,
  MEMORY_FACT_TOP,
  MEMORY_GRAPH_MEMORY_LIMIT,
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_PREDICATE_MERGE_THRESHOLD,
  memorySeedLimit,
} from "@/constants/memory";
import { generateEmbedding, isEmbeddingDimensionError } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getNeo4jDriver, isNeo4jConfigured } from "@/lib/neo4j/client";
import { normalizePredicate, predicateEmbeddingText } from "./canonicalize";
import {
  buildFactCreateCypher,
  buildOrphanGcCypher,
  CAPTURE_CREATE_CYPHER,
  CAPTURE_DELETE_CYPHER,
  CAPTURE_PENDING_CYPHER,
  CAPTURE_RETRY_CYPHER,
  CAPTURE_SEED_CYPHER,
  ENTITY_ALIAS_CYPHER,
  ENTITY_CREATE_CYPHER,
  ENTITY_EXACT_CYPHER,
  ENTITY_NEAREST_CYPHER,
  FACT_CLOSE_CYPHER,
  FACT_COUNT_CYPHER,
  FACT_CURRENT_CYPHER,
  FACT_DELETE_CYPHER,
  FACT_EXPAND_CYPHER,
  FACT_GET_CYPHER,
  FACT_LIST_CYPHER,
  FACT_PREDECESSOR_CYPHER,
  FACT_SEED_CYPHER,
  type FactEndLabel,
  GRAPH_ABOUT_CYPHER,
  GRAPH_ENTITY_RELATIONS_CYPHER,
  GRAPH_MEMORIES_CYPHER,
  GRAPH_MEMORY_COUNT_CYPHER,
  GRAPH_MEMORY_EDGES_CYPHER,
  PREDICATE_ALIAS_CYPHER,
  PREDICATE_CREATE_CYPHER,
  PREDICATE_EXACT_CYPHER,
  PREDICATE_LIST_CYPHER,
  PREDICATE_NEAREST_CYPHER,
  USER_UPSERT_CYPHER,
  VALUE_MERGE_CYPHER,
} from "./cypher";
import { normalizeEntityName } from "./extract";
import {
  decideFactWrite,
  renderRecalledFact,
  toRecallCandidate,
  type ExtractedFact,
} from "./facts";
import type { MemoryGraphRows } from "./graph-view";
import { extractFacts } from "./llm-facts";
import { createMemoryModel } from "./model";
import { mergeRecallCandidates, rankRecall } from "./recall";
import { normalizeQueryForRetrieval } from "./text";
import type {
  FactRecallMode,
  FactRecallResult,
  RecalledFact,
} from "./types";

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

  /** The user-anchor check: a fact about the user hangs off the anchor, not off an entity named "user". */
  private isAnchor(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return normalized === "user" || normalized === "i" || normalized === "me";
  }

  /**
   * Step 1 of resolution: the exact key, then the nearest above the threshold,
   * then create. The surface form is appended to `aliases` whenever it resolves
   * to an existing node, which is what makes the vocabulary inspectable later.
   */
  private async resolveEntity(
    userId: string,
    surface: string,
    embedding: number[] | null,
  ): Promise<string> {
    const driver = await this.requireDriver();
    const normalizedName = normalizeEntityName(surface);

    const exact = await driver.executeQuery(ENTITY_EXACT_CYPHER, {
      userId,
      normalizedName,
    });
    if (exact.records.length > 0) {
      const id = String(exact.records[0].get("id"));
      await driver.executeQuery(ENTITY_ALIAS_CYPHER, { id, userId, alias: surface });
      return id;
    }

    if (embedding) {
      // The statement filters on the threshold itself, so a nearest that is not
      // close enough returns nothing and the entity is created below.
      const nearest = await driver.executeQuery(ENTITY_NEAREST_CYPHER, {
        userId,
        vector: embedding,
        threshold: MEMORY_ENTITY_MERGE_THRESHOLD,
      });
      const best = nearest.records[0];
      if (best) {
        const id = String(best.get("id"));
        await driver.executeQuery(ENTITY_ALIAS_CYPHER, { id, userId, alias: surface });
        return id;
      }
    }

    const created = await driver.executeQuery(ENTITY_CREATE_CYPHER, {
      id: randomUUID(),
      userId,
      normalizedName,
      name: surface,
      embedding,
    });
    return String(created.records[0].get("id"));
  }

  /** A literal is keyed by its text — two identical instructions are one node. */
  private async resolveValue(userId: string, text: string): Promise<string> {
    const driver = await this.requireDriver();
    const result = await driver.executeQuery(VALUE_MERGE_CYPHER, {
      id: randomUUID(),
      userId,
      text,
    });
    return String(result.records[0].get("id"));
  }

  /**
   * Predicate resolution, same shape as the entity path but against its own
   * label, threshold and embedding template. The template matters: relations are
   * compared as relations, so "made by" and "made for" — which share every token
   * — do not collapse into each other.
   */
  private async resolvePredicate(
    userId: string,
    surface: string,
    embedding: number[] | null,
  ): Promise<string> {
    const driver = await this.requireDriver();
    const canonicalName = normalizePredicate(surface);

    const exact = await driver.executeQuery(PREDICATE_EXACT_CYPHER, {
      userId,
      canonicalName,
    });
    if (exact.records.length > 0) {
      const id = String(exact.records[0].get("id"));
      await driver.executeQuery(PREDICATE_ALIAS_CYPHER, {
        id,
        userId,
        alias: surface,
      });
      return id;
    }

    if (embedding) {
      const nearest = await driver.executeQuery(PREDICATE_NEAREST_CYPHER, {
        userId,
        embedding,
      });
      const best = nearest.records[0];
      if (best && Number(best.get("score")) >= MEMORY_PREDICATE_MERGE_THRESHOLD) {
        const id = String(best.get("id"));
        await driver.executeQuery(PREDICATE_ALIAS_CYPHER, {
          id,
          userId,
          alias: surface,
        });
        return id;
      }
    }

    const created = await driver.executeQuery(PREDICATE_CREATE_CYPHER, {
      id: randomUUID(),
      userId,
      canonicalName,
      embedding,
    });
    return String(created.records[0].get("id"));
  }

  /**
   * Turn one sentence's triples into graph writes.
   *
   * Embeddings for the distinct entity names and predicate surfaces are fetched
   * **concurrently**, not one round trip at a time: a capture with three facts
   * has up to nine names, and nine serial HTTP calls is most of the write's
   * latency.
   *
   * `sourceText` is embedded once for the whole capture and stamped on every
   * fact it produces, which is what lets recall seed on the sentence the user
   * actually said rather than on a triple no one typed.
   */
  async materializeFacts(
    userId: string,
    sourceText: string,
    facts: ExtractedFact[],
  ): Promise<number> {
    if (facts.length === 0) return 0;

    const embed = (text: string) => this.embedOrThrowOnMismatch(text, "memory fact");

    const surfaces = new Map<string, string>();
    for (const fact of facts) {
      surfaces.set(`subject:${fact.subject}`, fact.subject);
      surfaces.set(
        `predicate:${fact.predicate}`,
        predicateEmbeddingText(fact.predicate),
      );
      if (fact.objectKind === "entity") {
        surfaces.set(`object:${fact.object}`, fact.object);
      }
    }

    const entries = [...surfaces.entries()];
    const vectors = await Promise.all(entries.map(([, text]) => embed(text)));
    const vectorFor = new Map<string, number[] | null>();
    entries.forEach(([key], index) => vectorFor.set(key, vectors[index]));

    const factEmbedding = await embed(sourceText);
    const driver = await this.requireDriver();
    const now = new Date().toISOString();
    let written = 0;

    for (const fact of facts) {
      const subjectId = this.isAnchor(fact.subject)
        ? userId
        : await this.resolveEntity(
            userId,
            fact.subject,
            vectorFor.get(`subject:${fact.subject}`) ?? null,
          );
      const subjectLabel: FactEndLabel = this.isAnchor(fact.subject)
        ? "User"
        : "Entity";

      const objectLabel: FactEndLabel =
        fact.objectKind === "value" ? "Value" : "Entity";
      const objectId =
        objectLabel === "Value"
          ? await this.resolveValue(userId, fact.object)
          : await this.resolveEntity(
              userId,
              fact.object,
              vectorFor.get(`object:${fact.object}`) ?? null,
            );

      const predicateId = await this.resolvePredicate(
        userId,
        fact.predicate,
        vectorFor.get(`predicate:${fact.predicate}`) ?? null,
      );

      const current = await driver.executeQuery(FACT_CURRENT_CYPHER, {
        userId,
        subjectId,
        predicateId,
      });
      const currentFacts = current.records.map((record) => ({
        objectId: String(record.get("objectId")),
      }));

      const decision = decideFactWrite({
        predicate: normalizePredicate(fact.predicate),
        operation: fact.operation,
        incomingObjectId: objectId,
        currentFacts,
      });

      if (decision === "noop") continue;

      if (decision === "supersede") {
        await driver.executeQuery(FACT_CLOSE_CYPHER, {
          userId,
          factIds: current.records.map((record) => String(record.get("id"))),
          now,
        });
      }

      await driver.executeQuery(buildFactCreateCypher(subjectLabel, objectLabel), {
        id: randomUUID(),
        userId,
        subjectId,
        objectId,
        predicateId,
        embedding: factEmbedding,
        confidence: fact.confidence,
        sourceText,
        now,
      });
      written += 1;
    }

    return written;
  }

  async findKnownPredicates(userId: string): Promise<string[]> {
    const driver = await this.requireDriver();
    const result = await driver.executeQuery(PREDICATE_LIST_CYPHER, { userId });
    return result.records.map((record) => String(record.get("canonicalName")));
  }

  /**
   * Drain pending captures: extract, materialize, and delete the capture.
   *
   * A capture the model could not read is **not** deleted — its `attempts` count
   * rises so it stops costing a call after `MEMORY_CAPTURE_MAX_ATTEMPTS`, but the
   * sentence stays on disk and stays recallable. Losing the user's words because
   * the model had a bad day would be the one failure this design cannot absorb.
   */
  async extractPendingCaptures(
    userId: string,
    limit: number = MEMORY_CAPTURE_SWEEP_LIMIT,
  ): Promise<number> {
    const driver = await this.requireDriver();
    const pending = await driver.executeQuery(CAPTURE_PENDING_CYPHER, {
      userId,
      maxAttempts: MEMORY_CAPTURE_MAX_ATTEMPTS,
      limit,
    });

    if (pending.records.length === 0) return 0;

    const knownPredicates = await this.findKnownPredicates(userId);
    const model = createMemoryModel();

    let consumed = 0;
    for (const record of pending.records) {
      const id = String(record.get("id"));
      const text = String(record.get("text"));

      try {
        const facts = await extractFacts(model, text, knownPredicates);

        if (facts === null) {
          // A refused schema is the model's failure, not a transport one: count
          // the attempt so the loop terminates, but keep the sentence.
          await driver.executeQuery(CAPTURE_RETRY_CYPHER, { id, userId });
          continue;
        }

        await this.materializeFacts(userId, text, facts);
        await driver.executeQuery(CAPTURE_DELETE_CYPHER, { id, userId });
        consumed += 1;
      } catch (error) {
        logger.error({ err: error, captureId: id }, "Capture extraction failed");
        await driver.executeQuery(CAPTURE_RETRY_CYPHER, { id, userId });
      }
    }

    return consumed;
  }

  /**
   * Recall for one turn.
   *
   * The shape is seed -> expand -> rank -> render, and the failure policy is the
   * part worth reading:
   *
   * - No query, no Neo4j, or no seeds returns **empty** with a reason. It never
   *   falls back to the newest N facts, because the first rows of a corpus are
   *   not an answer to a question.
   * - If **expansion** fails after the seeds arrived, the seeds are ranked and
   *   returned anyway. They came from the index and they are good matches;
   *   discarding them because the traversal hit an error throws away the half
   *   that worked.
   *
   * Captures are seeded alongside facts so a sentence saved one second ago is
   * recallable before any model has read it.
   */
  async recallFacts(
    userId: string,
    query: string,
    top: number = MEMORY_FACT_TOP,
  ): Promise<FactRecallResult> {
    const empty = (mode: FactRecallMode): FactRecallResult => ({
      facts: [],
      metadata: { mode, seedCount: 0, expandedCount: 0, totalCandidates: 0 },
    });

    const normalized = normalizeQueryForRetrieval(query);
    if (normalized.trim() === "") return empty("vector");

    if (!isNeo4jConfigured()) {
      logger.warn("Neo4j is not configured; memory recall is disabled");
      return empty("vector");
    }

    const driver = await this.requireDriver();

    let queryVector: number[] | null;
    try {
      queryVector = await generateEmbedding(normalized);
    } catch (error) {
      if (isEmbeddingDimensionError(error)) throw error;
      logger.error({ err: error }, "Query embedding failed; recall returns nothing");
      return empty("vector");
    }

    const seedLimit = memorySeedLimit(top);

    const factSeeds = await driver.executeQuery(FACT_SEED_CYPHER, {
      userId,
      queryVector,
      k: seedLimit,
    });
    const captureSeeds = await driver.executeQuery(CAPTURE_SEED_CYPHER, {
      userId,
      queryVector,
      k: MEMORY_CAPTURE_SEED_LIMIT,
    });

    const factCandidates = factSeeds.records.map((record) =>
      toRecallCandidate({
        id: String(record.get("id")),
        sourceText: String(record.get("sourceText") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
        vectorScore: Number(record.get("vectorScore")),
        hops: 0,
        pathWeight: 1,
      }),
    );

    const captureCandidates = captureSeeds.records.map((record) =>
      toRecallCandidate({
        id: String(record.get("id")),
        sourceText: String(record.get("text") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
        vectorScore: Number(record.get("vectorScore")),
        hops: 0,
        pathWeight: 1,
      }),
    );

    if (factCandidates.length === 0 && captureCandidates.length === 0) {
      return empty("vector");
    }

    let expandedCandidates: typeof factCandidates = [];
    let mode: FactRecallMode = "vector";

    if (factCandidates.length > 0) {
      try {
        const expanded = await driver.executeQuery(FACT_EXPAND_CYPHER, {
          userId,
          seedIds: factCandidates.map((candidate) => candidate.id),
          expansionLimit: seedLimit,
        });
        expandedCandidates = expanded.records.map((record) =>
          toRecallCandidate({
            id: String(record.get("id")),
            sourceText: String(record.get("sourceText") ?? ""),
            createdAt: String(record.get("createdAt") ?? ""),
            vectorScore: 0,
            hops: Number(record.get("hops")),
            pathWeight: Number(record.get("pathWeight")),
          }),
        );
        mode = "graph";
      } catch (error) {
        // Seeds survived seed-level work; throw away only the traversal.
        logger.error(
          { err: error },
          "Memory expansion failed; returning the seeds unexpanded",
        );
      }
    }

    const merged = mergeRecallCandidates(factCandidates, expandedCandidates);
    const rankedFacts = rankRecall([...merged.candidates, ...captureCandidates], {
      top,
    });

    const captureIds = new Set(captureCandidates.map((candidate) => candidate.id));
    const factIds = rankedFacts.map((row) => row.id).filter((id) => !captureIds.has(id));

    const predecessors = await this.loadPredecessors(userId, factIds);

    const facts: RecalledFact[] = rankedFacts.map((row) => ({
      id: row.id,
      kind: captureIds.has(row.id) ? "capture" : "fact",
      text: renderRecalledFact(row.content, predecessors.get(row.id) ?? null),
      createdAt: row.createdAt,
    }));

    return {
      facts,
      metadata: {
        mode,
        seedCount: factCandidates.length + captureCandidates.length,
        expandedCount: merged.addedCount,
        totalCandidates: merged.candidates.length + captureCandidates.length,
      },
    };
  }

  /**
   * One predecessor per recalled fact: the most recent fact the graph closed on
   * the same `(S, P)`. The query orders by `validTo DESC`, so the first row per
   * fact id wins and the rest are dropped — bounded history, no classifier.
   */
  private async loadPredecessors(
    userId: string,
    factIds: string[],
  ): Promise<Map<string, { sourceText: string; validTo: string }>> {
    const predecessors = new Map<string, { sourceText: string; validTo: string }>();
    if (factIds.length === 0) return predecessors;

    const driver = await this.requireDriver();
    const result = await driver.executeQuery(FACT_PREDECESSOR_CYPHER, {
      userId,
      factIds,
    });

    for (const record of result.records) {
      const factId = String(record.get("factId"));
      if (predecessors.has(factId)) continue;
      predecessors.set(factId, {
        sourceText: String(record.get("sourceText") ?? ""),
        validTo: String(record.get("validTo") ?? ""),
      });
    }

    return predecessors;
  }

  /**
   * The paginated listing, newest first. `isCurrent = true` because the list
   * shows what is true now — history is reachable through recall's predecessor
   * line, not by scrolling the list.
   *
   * The count is a second statement rather than a `count(*) OVER ()` beside the
   * page, because the window function would force the ordering pass over every
   * row on every page; an indexed count is cheaper than that.
   */
  async listFacts(
    userId: string,
    limit: number = MEMORY_FACT_PAGE_SIZE,
    offset: number = 0,
  ): Promise<{ facts: RecalledFact[]; total: number }> {
    const driver = await this.requireDriver();
    const [page, count] = await Promise.all([
      driver.executeQuery(FACT_LIST_CYPHER, { userId, limit, offset }),
      driver.executeQuery(FACT_COUNT_CYPHER, { userId }),
    ]);

    return {
      facts: page.records.map((record) => ({
        id: String(record.get("id")),
        kind: "fact" as const,
        text: String(record.get("text") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
      })),
      total: Number(count.records[0]?.get("total") ?? 0),
    };
  }

  /**
   * One fact by id, for the detail route. The `userId` is in the `MATCH`, so a
   * fact belonging to another user reads as absent rather than as forbidden —
   * there is nothing here a caller could learn from the difference.
   */
  async getFact(userId: string, id: string): Promise<RecalledFact | null> {
    const driver = await this.requireDriver();
    const result = await driver.executeQuery(FACT_GET_CYPHER, { id, userId });
    const record = result.records[0];
    if (!record) return null;

    return {
      id: String(record.get("id")),
      kind: "fact",
      text: String(record.get("sourceText") ?? ""),
      createdAt: String(record.get("createdAt") ?? ""),
    };
  }

  /**
   * The one real delete in the design — everything else closes.
   *
   * The `userId` is in the `MATCH`, so `app/api/memories/[id]`'s ownership check
   * is a second lock rather than the only one, matching the store-level boundary
   * the memory API already had.
   */
  async deleteFact(userId: string, id: string): Promise<boolean> {
    const driver = await this.requireDriver();
    const result = await driver.executeQuery(FACT_DELETE_CYPHER, { id, userId });
    const deleted = result.summary.counters.updates().nodesDeleted > 0;
    if (deleted) await this.gcOrphans(userId);
    return deleted;
  }

  /**
   * Collect the nodes nothing points at any more. Three statements rather than
   * one, so each uses its own `(userId)` index; see `buildOrphanGcCypher` for
   * why `ABOUT` counts as a reference.
   */
  async gcOrphans(userId: string): Promise<void> {
    const driver = await this.requireDriver();
    for (const label of ["Entity", "Predicate", "Value"] as const) {
      await driver.executeQuery(buildOrphanGcCypher(label), { userId });
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
