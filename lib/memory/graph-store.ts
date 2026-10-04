import "server-only";
import { randomUUID } from "node:crypto";
import {
  MEMORY_CAPTURE_MAX_ATTEMPTS,
  MEMORY_CAPTURE_SWEEP_LIMIT,
  MEMORY_ENTITY_MERGE_THRESHOLD,
  MEMORY_FACT_PAGE_SIZE,
  MEMORY_FACT_TOP,
  MEMORY_GRAPH_MEMORY_LIMIT,
  MEMORY_LLM_EDGE_TYPES,
  MEMORY_PREDICATE_CLUSTER_THRESHOLD,
  MEMORY_PREDICATE_MERGE_THRESHOLD,
  MEMORY_RECONCILE_LIMIT,
  FUNCTIONAL_PREDICATES,
} from "@/constants/memory";
import { generateEmbedding, isEmbeddingDimensionError } from "@/lib/embeddings";
import { logger } from "@/lib/logger";
import { getNeo4jDriver, isNeo4jConfigured } from "@/lib/neo4j/client";
import { emptyRecallResult, runRecallPipeline } from "./pipeline";
import {
  normalizeEntityName,
  normalizePredicate,
  predicateEmbeddingText,
} from "./canonicalize";
import {
  buildFactCreateCypher,
  buildOrphanGcCypher,
  CAPTURE_CREATE_CYPHER,
  CAPTURE_DELETE_CYPHER,
  CAPTURE_PENDING_CYPHER,
  CAPTURE_PENDING_COUNT_CYPHER,
  CAPTURE_RETRY_CYPHER,
  ENTITY_ALIAS_CYPHER,
  ENTITY_CREATE_CYPHER,
  ENTITY_EXACT_CYPHER,
  ENTITY_NEAREST_CYPHER,
  FACT_CLOSE_CYPHER,
  FACT_COUNT_CYPHER,
  FACT_CURRENT_CYPHER,
  FACT_DELETE_CYPHER,
  FACT_EMBEDDING_CYPHER,
  FACT_GET_CYPHER,
  FACT_LIST_CYPHER,
  FACT_RECONCILE_CYPHER,
  FACT_VECTORLESS_CYPHER,
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
  PREDICATE_MERGE_CYPHER,
  PREDICATE_NEAREST_CYPHER,
  USER_UPSERT_CYPHER,
  VALUE_MERGE_CYPHER,
} from "./cypher";
import {
  decideFactWrite,
  selectSuperseded,
  type ExtractedFact,
} from "./facts";
import type { MemoryGraphRows } from "./graph-view";
import { extractFacts } from "./llm-facts";
import { selectMergePairs } from "./merge";
import { createMemoryModel } from "./model";
import type {
  FactRecallResult,
  RecalledFact,
  SweepSummary,
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
      // At-or-above, not strictly above, so a threshold of `t` means "similarity
      // t suffices" — which is what the constant's comment promises. The vector
      // index returns rows nearest-first and the statement asks for one, so this
      // record is the best match.
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
   * Close facts the extractor could not settle.
   *
   * Scope is deliberately narrow: only facts under a **functional** predicate
   * whose `(subject, predicate)` carries more than one current fact. A
   * functional predicate holds one value — two current `WORKS_AS` facts on the
   * same subject means one of them is stale, and the newer one wins. A
   * multi-valued predicate ("likes apple", "likes banana") never matches, which
   * is the whole reason the query is gated on the predicate name.
   */
  async reconcileFacts(
    userId: string,
    limit: number = MEMORY_RECONCILE_LIMIT,
  ): Promise<number> {
    const functional = [...FUNCTIONAL_PREDICATES];
    if (functional.length === 0) return 0;

    const driver = await this.requireDriver();
    const result = await driver.executeQuery(FACT_RECONCILE_CYPHER, {
      userId,
      predicates: functional,
      limit,
    });

    const byGroup = new Map<string, { id: string; createdAt: string }[]>();
    for (const record of result.records) {
      const key = `${record.get("subjectId")}::${record.get("predicateId")}`;
      const rows = byGroup.get(key) ?? [];
      rows.push({
        id: String(record.get("id")),
        createdAt: String(record.get("createdAt") ?? ""),
      });
      byGroup.set(key, rows);
    }

    const now = new Date().toISOString();
    let closed = 0;

    for (const rows of byGroup.values()) {
      const superseded = selectSuperseded(rows);
      if (superseded.length === 0) continue;
      const outcome = await driver.executeQuery(FACT_CLOSE_CYPHER, {
        userId,
        factIds: superseded,
        now,
      });
      closed += Number(outcome.records[0]?.get("closed") ?? 0);
    }

    return closed;
  }

  /**
   * Fold near-duplicate predicates into one, rewiring their facts.
   *
   * The candidate set and its embeddings come from `PREDICATE_LIST_CYPHER`;
   * which pairs to merge is `selectMergePairs`, which is pure and tested. The
   * statement is idempotent per pair — a pair that no longer exists merges
   * nothing — so a crash mid-sweep costs a re-run, not a corrupt vocabulary.
   */
  async mergePredicates(
    userId: string,
    threshold: number = MEMORY_PREDICATE_CLUSTER_THRESHOLD,
  ): Promise<number> {
    const driver = await this.requireDriver();
    const listed = await driver.executeQuery(PREDICATE_LIST_CYPHER, { userId });

    const candidates = listed.records.map((record) => ({
      id: String(record.get("id")),
      canonicalName: String(record.get("canonicalName") ?? ""),
      embedding: (record.get("embedding") as number[] | null) ?? null,
      factCount: Number(record.get("factCount") ?? 0),
    }));

    const pairs = selectMergePairs(candidates, threshold);
    let merged = 0;

    for (const pair of pairs) {
      await driver.executeQuery(PREDICATE_MERGE_CYPHER, {
        userId,
        keepId: pair.keepId,
        dupId: pair.dupId,
      });
      merged += 1;
    }

    if (merged > 0) await this.gcOrphans(userId);
    return merged;
  }

  /** Facts written during an embedding outage, waiting for the vector recall needs. */
  async embedVectorlessFacts(
    userId: string,
    limit: number = MEMORY_CAPTURE_SWEEP_LIMIT,
  ): Promise<number> {
    const driver = await this.requireDriver();
    const pending = await driver.executeQuery(FACT_VECTORLESS_CYPHER, {
      userId,
      limit,
    });

    let filled = 0;
    for (const record of pending.records) {
      const id = String(record.get("id"));
      const text = String(record.get("sourceText") ?? "");
      const embedding = await this.embedOrThrowOnMismatch(text, "memory fact");
      if (embedding === null) continue;
      await driver.executeQuery(FACT_EMBEDDING_CYPHER, { id, userId, embedding });
      filled += 1;
    }

    return filled;
  }

  /**
   * One pass of everything that keeps the graph current, in order.
   *
   * Captures first: a sentence the user just typed deserves its facts before the
   * vocabulary work that will decide which predicate those facts use.
   */
  async sweep(userId: string): Promise<SweepSummary> {
    const captures = await this.extractPendingCaptures(userId);
    const reconciled = await this.reconcileFacts(userId);
    const merged = await this.mergePredicates(userId);
    const embedded = await this.embedVectorlessFacts(userId);
    return { captures, reconciled, merged, embedded };
  }

  /**
   * Recall for one turn.
   *
   * The composition lives in `lib/memory/pipeline.ts` — a guardless module, so
   * `scripts/eval-memory.ts` can measure the same code chat runs rather than a
   * copy of it. This method supplies only the two things the pipeline cannot
   * build itself: a driver and an embedder, the latter carrying the embedding
   * policy (`null` for an outage, a throw for a broken index).
   */
  async recallFacts(
    userId: string,
    query: string,
    top: number = MEMORY_FACT_TOP,
  ): Promise<FactRecallResult> {
    if (!isNeo4jConfigured()) {
      logger.warn("Neo4j is not configured; memory recall is disabled");
      return emptyRecallResult();
    }

    const driver = await this.requireDriver();
    return runRecallPipeline(
      {
        driver,
        embed: (text) => this.embedOrThrowOnMismatch(text, "memory query"),
      },
      userId,
      query,
      top,
    );
  }

  /**
   * The paginated listing, newest first. `isCurrent = true` because the list
   * shows what is true now — history is reachable through recall's predecessor
   * line, not by scrolling the list.
   *
   * The count is a second statement rather than a `count(*) OVER ()` beside the
   * page, because the window function would force the ordering pass over every
   * row on every page; an indexed count is cheaper than that.
   *
   * `pending` rides along because the page cannot answer "is a fact on its way?".
   * A capture is staged before any model sees it, so a save reports success with
   * no fact in the page; the pending count is what tells the reader to look
   * again rather than conclude the save was lost.
   */
  async listFacts(
    userId: string,
    limit: number = MEMORY_FACT_PAGE_SIZE,
    offset: number = 0,
  ): Promise<{ facts: RecalledFact[]; total: number; pending: number }> {
    const driver = await this.requireDriver();
    const [page, count, pending] = await Promise.all([
      driver.executeQuery(FACT_LIST_CYPHER, { userId, limit, offset }),
      driver.executeQuery(FACT_COUNT_CYPHER, { userId }),
      driver.executeQuery(CAPTURE_PENDING_COUNT_CYPHER, {
        userId,
        maxAttempts: MEMORY_CAPTURE_MAX_ATTEMPTS,
      }),
    ]);

    return {
      facts: page.records.map((record) => ({
        id: String(record.get("id")),
        kind: "fact" as const,
        text: String(record.get("text") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
      })),
      total: Number(count.records[0]?.get("total") ?? 0),
      pending: Number(pending.records[0]?.get("pending") ?? 0),
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
          // The kinds the view knows how to draw, so an edge type it has no
          // styling for is not asked for in the first place.
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
