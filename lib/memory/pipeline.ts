/**
 * The recall composition, out of the store so it can be measured.
 *
 * `graph-store.ts` carries `"server-only"`, which Next aliases at build time and
 * `tsx` does not resolve at all, so `scripts/eval-memory.ts` cannot import it —
 * and an eval that rebuilt this composition from the same primitives would be
 * measuring its own copy rather than the code chat runs. `cypher.ts` holds the
 * statements for exactly this reason; this is the same move applied to the logic
 * above them.
 *
 * Nothing here reads the environment or opens a connection: the driver and the
 * embedder arrive as parameters. That is also what lets a unit test drive it
 * with a fake.
 */
import {
  MEMORY_CAPTURE_SEED_LIMIT,
  MEMORY_SEED_SCORE_FLOOR,
  memorySeedLimit,
} from "@/constants/memory";
import { logger } from "@/lib/logger";
import {
  CAPTURE_SEED_CYPHER,
  FACT_EXPAND_CYPHER,
  FACT_PREDECESSOR_CYPHER,
  FACT_SEED_CYPHER,
} from "./cypher";
import { renderRecalledFact, toRecallCandidate } from "./facts";
import { mergeRecallCandidates, rankRecall } from "./recall";
import { normalizeQueryForRetrieval } from "./text";
import type { FactRecallMode, FactRecallResult, RecalledFact } from "./types";

/**
 * The sliver of the Neo4j driver this pipeline uses, so a caller can pass the
 * real driver and a test can pass a fake. Narrower than the driver on purpose:
 * a fake that had to satisfy `Driver` would be a mock of the whole client.
 */
export interface RecallDriver {
  executeQuery(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<{ records: Array<{ get(key: string): unknown }> }>;
}

/**
 * `embed` carries the embedding policy, so this module does not have to know it:
 * **null means an outage** — a gap recall can heal later, which returns an empty
 * result — while a **throw** means the index is broken, and propagates, because a
 * query vector at the wrong width can never match the stored ones and presenting
 * that as "no memories" would make a broken index look like an empty one.
 */
export interface RecallDeps {
  driver: RecallDriver;
  embed: (text: string) => Promise<number[] | null>;
}

/**
 * No memories, with a reason. `vector` rather than `graph` because nothing was
 * traversed — the mode reports which half ran, not which one was intended.
 */
export function emptyRecallResult(
  mode: FactRecallMode = "vector",
): FactRecallResult {
  return {
    facts: [],
    metadata: { mode, seedCount: 0, expandedCount: 0, totalCandidates: 0 },
  };
}

/**
 * Recall for one turn.
 *
 * - No query, or no seeds, returns **empty** with a reason. It never falls back
 *   to the newest N facts, because the first rows of a corpus are not an answer
 *   to a question.
 * - A seed below `MEMORY_SEED_SCORE_FLOOR` is dropped **before expansion**, not
 *   after ranking. The index always returns its `k` nearest rows, so a floor is
 *   what makes an unrelated question return nothing — and gating expansion is
 *   what keeps an unrelated seed from reaching a subgraph the ranker would then
 *   have no reason to drop.
 * - If **expansion** fails after the seeds arrived, the seeds are ranked and
 *   returned anyway. They came from the index and they are good matches;
 *   discarding them because the traversal hit an error throws away the half that
 *   worked.
 *
 * Captures are seeded alongside facts so a sentence saved one second ago is
 * recallable before any model has read it.
 */
export async function runRecallPipeline(
  deps: RecallDeps,
  userId: string,
  query: string,
  top: number,
): Promise<FactRecallResult> {
  const normalized = normalizeQueryForRetrieval(query);
  if (normalized.trim() === "") return emptyRecallResult();

  const queryVector = await deps.embed(normalized);
  if (queryVector === null) {
    logger.warn({ userId }, "Query embedding unavailable; recall returns nothing");
    return emptyRecallResult();
  }

  const seedLimit = memorySeedLimit(top);

  const factSeeds = await deps.driver.executeQuery(FACT_SEED_CYPHER, {
    userId,
    queryVector,
    k: seedLimit,
  });
  const captureSeeds = await deps.driver.executeQuery(CAPTURE_SEED_CYPHER, {
    userId,
    queryVector,
    k: MEMORY_CAPTURE_SEED_LIMIT,
  });

  const factCandidates = factSeeds.records
    .map((record) =>
      toRecallCandidate({
        id: String(record.get("id")),
        sourceText: String(record.get("sourceText") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
        vectorScore: Number(record.get("vectorScore")),
        hops: 0,
        pathWeight: 1,
      }),
    )
    .filter((candidate) => candidate.vectorScore >= MEMORY_SEED_SCORE_FLOOR);

  const captureCandidates = captureSeeds.records
    .map((record) =>
      toRecallCandidate({
        id: String(record.get("id")),
        sourceText: String(record.get("text") ?? ""),
        createdAt: String(record.get("createdAt") ?? ""),
        vectorScore: Number(record.get("vectorScore")),
        hops: 0,
        pathWeight: 1,
      }),
    )
    .filter((candidate) => candidate.vectorScore >= MEMORY_SEED_SCORE_FLOOR);

  if (factCandidates.length === 0 && captureCandidates.length === 0) {
    return emptyRecallResult();
  }

  let expandedCandidates: typeof factCandidates = [];
  let mode: FactRecallMode = "vector";

  if (factCandidates.length > 0) {
    try {
      const expanded = await deps.driver.executeQuery(FACT_EXPAND_CYPHER, {
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

  const predecessors = await loadPredecessors(deps, userId, factIds);

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
async function loadPredecessors(
  deps: RecallDeps,
  userId: string,
  factIds: string[],
): Promise<Map<string, { sourceText: string; validTo: string }>> {
  const predecessors = new Map<string, { sourceText: string; validTo: string }>();
  if (factIds.length === 0) return predecessors;

  const result = await deps.driver.executeQuery(FACT_PREDECESSOR_CYPHER, {
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
