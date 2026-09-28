import {
  MEMORY_TRAVERSAL_DECAY,
  MEMORY_WEIGHT_GRAPH,
  MEMORY_WEIGHT_SEED,
} from "@/constants/memory";

/** One hop's weight: a seed is 1, each hop multiplies by the decay. */
export function hopDecay(hops: number): number {
  if (hops <= 0) return 1;
  return MEMORY_TRAVERSAL_DECAY ** hops;
}

const HALF_LIFE_DAYS = 90;

/** A bounded freshness term. An unparseable date scores 0, never NaN. */
export function recencyBonus(createdAt: string, now: Date = new Date()): number {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 0;
  const ageDays = (now.getTime() - created.getTime()) / 86_400_000;
  if (ageDays <= 0) return 1;
  return 1 / (1 + ageDays / HALF_LIFE_DAYS);
}

export interface RecallCandidate {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  vectorScore: number;
  /** 0 for a seed, 1..MEMORY_RECALL_HOPS for a reached node. */
  hops: number;
  /** Product of the traversed edge weights, 1 for a seed. */
  pathWeight: number;
}

/**
 * Fuses the semantic seeds with the rows the traversal reached, keeping the
 * best hop count where both name the same memory.
 *
 * It returns the *added* count alongside the rows because that is what
 * `graphExpandedCount` reports, and the two are not the same number. `EXPAND_CYPHER`
 * starts from the seeds, so every seed comes back as an expanded row too: the
 * length of the expanded array counts seeds the dedupe then discards, and an
 * operator reading it would conclude the graph reached memories it never
 * reached. Counting what survived — ids the seeds did not already name —
 * leaves that one metric honest.
 */
export function mergeRecallCandidates<T extends RecallCandidate>(
  seeds: T[],
  expanded: T[],
): { candidates: T[]; addedCount: number } {
  const byId = new Map<string, T>();
  const seeded = new Set<string>();
  for (const candidate of seeds) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.hops < existing.hops) byId.set(candidate.id, candidate);
    seeded.add(candidate.id);
  }
  for (const candidate of expanded) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.hops < existing.hops) byId.set(candidate.id, candidate);
  }
  let addedCount = 0;
  for (const id of byId.keys()) if (!seeded.has(id)) addedCount += 1;
  return { candidates: [...byId.values()], addedCount };
}

const DEFAULT_TOP = 5;

/**
 * The blend that replaces :772's five-way fusion. Those five scores existed
 * because the graph was a heuristic over a flat corpus; with real edges, the
 * seed similarity and the graph path are the two things worth weighting.
 *
 * Generic in its candidate type so a caller that carries display fields the
 * ranking does not use — the store's `userName`, `userEmail` — gets them back
 * typed rather than having to look them up again by id. The ranking reads only
 * `RecallCandidate`'s members either way.
 */
export function rankRecall<T extends RecallCandidate>(
  candidates: T[],
  options: { top?: number } = {},
): (T & { score: number })[] {
  const top = options.top ?? DEFAULT_TOP;
  if (candidates.length === 0 || top <= 0) return [];

  return candidates
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.vectorScore * MEMORY_WEIGHT_SEED +
        candidate.pathWeight * MEMORY_WEIGHT_GRAPH * hopDecay(candidate.hops) +
        recencyBonus(candidate.createdAt) * 0.05,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}
