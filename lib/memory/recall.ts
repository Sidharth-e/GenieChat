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

export type RankedMemory = RecallCandidate & { score: number };

const DEFAULT_TOP = 5;

/**
 * The blend that replaces :772's five-way fusion. Those five scores existed
 * because the graph was a heuristic over a flat corpus; with real edges, the
 * seed similarity and the graph path are the two things worth weighting.
 */
export function rankRecall(
  candidates: RecallCandidate[],
  options: { top?: number } = {},
): RankedMemory[] {
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
