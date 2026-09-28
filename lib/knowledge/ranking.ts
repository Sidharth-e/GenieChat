import { RRF_K } from "@/constants/knowledge";

export interface RankedHit {
  id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion. The score depends only on an item's rank in a list,
 * which is why a pgvector cosine distance and a Postgres `ts_rank_cd` can be
 * fused without normalising either.
 */
export function rrfScore(rank: number, k: number = RRF_K): number {
  if (rank < 1) {
    throw new Error(`rrfScore expects a 1-based rank, received ${rank}`);
  }
  return 1 / (k + rank);
}

export function combineRrf(
  rankLists: string[][],
  k: number = RRF_K,
): RankedHit[] {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const list of rankLists) {
    // A duplicate id inside one list must count once, at its best rank.
    const seenInList = new Set<string>();
    for (let index = 0; index < list.length; index += 1) {
      const id = list[index];
      if (seenInList.has(id)) continue;
      seenInList.add(id);

      if (!firstSeen.has(id)) firstSeen.set(id, order++);
      scores.set(id, (scores.get(id) ?? 0) + rrfScore(index + 1, k));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0);
    });
}
