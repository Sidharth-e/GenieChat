import { randomUUID } from "node:crypto";
import {
  MEMORY_ENTITY_MERGE_THRESHOLD,
  MEMORY_LLM_EDGE_TYPES,
} from "@/constants/memory";
import {
  ENTITY_ABOUT_CYPHER,
  ENTITY_EXACT_CYPHER,
  ENTITY_NEAREST_CYPHER,
  MEMORY_ENRICHED_AT_CYPHER,
  RELATION_CYPHER,
  buildMemoryEdgeCypher,
} from "./cypher";
import type { Enrichment, EnrichmentEntity } from "./enrichment-schema";

/** One statement, executed wherever the caller's transaction lives. */
export type StatementRunner = (
  cypher: string,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>[]>;

export interface EnrichmentWrite {
  memoryId: string;
  userId: string;
  enrichment: Enrichment;
  /**
   * The embedding per `normalizedName`, `null` where the provider was down.
   * Resolved before the transaction opens, for the reason `PreparedEntity`
   * gives: one HTTP round trip per entity is a long time to hold write locks.
   */
  entityEmbeddings: Map<string, number[] | null>;
}

/** What one sweep iteration achieved. */
export type EnrichmentOutcome = "enriched" | "failed";

/**
 * Whether an iteration of the recovery sweep may be reported as a success.
 *
 * A memory reaches the sweep for one of two reasons, and `vectorless` names the
 * second: its `embedding IS NULL`, so it was written while the provider was
 * down. For that memory the vector *is* the work — `embedOrNull` returns null
 * when the provider is down or unconfigured, and the run can then end with the
 * memory exactly as vectorless as it began. Counting that as `enriched` exits
 * the sweep 0 and reports a repaired corpus while the rows it was run for stay
 * invisible to recall, which seeds on the vector alone.
 *
 * A memory that was never missing a vector passes `vectorless: false` and is
 * never failed for one; `embedded` is only meaningful in the vectorless case.
 */
export function classifyEnrichmentOutcome(input: {
  vectorless: boolean;
  embedded: boolean;
}): EnrichmentOutcome {
  if (input.vectorless && !input.embedded) return "failed";
  return "enriched";
}

/**
 * Turns a validated extraction into graph writes. Driver-free and
 * transaction-free on purpose: the store runs it inside its write transaction
 * and `scripts/check-memory.ts` runs it against a session, so both execute this
 * code and this is a seam a unit test can drive without a database.
 */
export async function writeEnrichment(
  run: StatementRunner,
  write: EnrichmentWrite,
): Promise<void> {
  const { memoryId, userId, enrichment, entityEmbeddings } = write;
  const now = new Date().toISOString();

  // Resolve every entity first: a relation is only meaningful between nodes
  // that exist, and resolution is what decides which node each name *is*.
  const resolved = new Map<string, string>();
  for (const entity of enrichment.entities) {
    resolved.set(
      entity.normalizedName,
      await resolveEntityName(run, userId, entity, entityEmbeddings.get(entity.normalizedName) ?? null),
    );
  }

  for (const entity of enrichment.entities) {
    const normalizedName = resolved.get(entity.normalizedName);
    if (!normalizedName) continue;
    await run(ENTITY_ABOUT_CYPHER, {
      id: memoryId,
      userId,
      normalizedName,
      entityId: randomUUID(),
      name: entity.name,
      now,
      embedding: entityEmbeddings.get(entity.normalizedName) ?? null,
    });
  }

  if (enrichment.relations.length > 0) {
    await run(RELATION_CYPHER, {
      userId,
      // Rewritten onto the resolved names. Left as the model wrote them, a
      // relation naming a collapsed entity would match no node and disappear.
      relations: enrichment.relations.map((relation) => ({
        from: resolved.get(relation.from) ?? relation.from,
        to: resolved.get(relation.to) ?? relation.to,
        type: relation.type,
      })),
      now,
    });
  }

  for (const type of MEMORY_LLM_EDGE_TYPES) {
    const edges = enrichment.memoryEdges.filter((edge) => edge.type === type);
    if (edges.length === 0) continue;
    await run(buildMemoryEdgeCypher(type), { id: memoryId, userId, edges, now });
  }

  // Last, and unconditionally: the marker means "the model has seen this
  // memory", which is true even when it had nothing to extract.
  await run(MEMORY_ENRICHED_AT_CYPHER, { id: memoryId, userId, now });
}

/**
 * The spec's resolution order, in order. Step 1 is the constraint, step 2 the
 * vector index, step 3 the caller's `MERGE` on the returned name.
 */
async function resolveEntityName(
  run: StatementRunner,
  userId: string,
  entity: EnrichmentEntity,
  embedding: number[] | null,
): Promise<string> {
  const exact = await run(ENTITY_EXACT_CYPHER, {
    userId,
    normalizedName: entity.normalizedName,
  });
  if (exact.length > 0) return entity.normalizedName;

  // No vector means no step 2 — the entity exact-matches or it is created.
  if (!embedding) return entity.normalizedName;

  const nearest = await run(ENTITY_NEAREST_CYPHER, {
    userId,
    vector: embedding,
    threshold: MEMORY_ENTITY_MERGE_THRESHOLD,
  });
  const name = String(nearest[0]?.normalizedName ?? "");
  return name || entity.normalizedName;
}
