import * as z from "zod";
import { MEMORY_LLM_EDGE_TYPES, type MemoryLlmEdgeType } from "@/constants/memory";
import { normalizeEntityName } from "./canonicalize";

const rawEntity = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
});

const rawRelation = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
});

const rawMemoryEdge = z.object({
  targetId: z.string().min(1),
  type: z.enum(MEMORY_LLM_EDGE_TYPES),
  reason: z.string().default(""),
});

export const enrichmentSchema = z.object({
  entities: z.array(rawEntity),
  relations: z.array(rawRelation).default([]),
  memoryEdges: z.array(rawMemoryEdge).default([]),
});

export interface EnrichmentEntity {
  name: string;
  normalizedName: string;
  type: string;
}

export interface EnrichmentRelation {
  from: string;
  to: string;
  type: string;
}

export interface EnrichmentMemoryEdge {
  targetId: string;
  type: MemoryLlmEdgeType;
  reason: string;
}

export interface Enrichment {
  entities: EnrichmentEntity[];
  relations: EnrichmentRelation[];
  memoryEdges: EnrichmentMemoryEdge[];
}

/**
 * Validates a model's response into the only shape the store will write. A
 * rejection is a null, never a throw and never a repair: a guessed edge is
 * worse than a missing one.
 */
export function parseEnrichment(raw: unknown): Enrichment | null {
  const result = enrichmentSchema.safeParse(raw);
  if (!result.success) return null;

  const entities: EnrichmentEntity[] = [];
  for (const entity of result.data.entities) {
    const normalizedName = normalizeEntityName(entity.name);
    // Drop rather than reject: one bad name in an otherwise good extraction
    // should not discard the whole enrichment. An empty name is the one case
    // that must never reach a MERGE.
    if (!normalizedName) continue;
    entities.push({ name: entity.name, normalizedName, type: entity.type });
  }

  const defined = new Set(entities.map((entity) => entity.normalizedName));
  const relations: EnrichmentRelation[] = [];
  for (const relation of result.data.relations) {
    const from = normalizeEntityName(relation.from);
    const to = normalizeEntityName(relation.to);
    if (!from || !to) continue;
    if (!defined.has(from) || !defined.has(to)) continue;
    relations.push({ from, to, type: relation.type });
  }

  return { entities, relations, memoryEdges: result.data.memoryEdges };
}
