/**
 * Offline vocabulary consolidation.
 *
 * Predicates are open — the extractor coins them — so over time the graph
 * accumulates near-synonyms that survived the write-time threshold. This closes
 * that drift: on a **tighter** threshold than the write path uses, because the
 * two decisions cost very different amounts. A write-time false positive merges
 * one fact into the wrong predicate; a sweep-time false positive rewires every
 * fact on both nodes and deletes one of them.
 *
 * Deterministic by construction: no `Math.random`, and ties are broken by
 * `factCount` and then by id, so a remount or a re-run produces the same pairs.
 */

export interface MergeCandidate {
  id: string;
  canonicalName: string;
  embedding: number[] | null;
  factCount?: number;
}

export interface MergePair {
  keepId: string;
  dupId: string;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Greedy clustering, most-used node first.
 *
 * Each candidate is spent at most once as either side of a pair, which is what
 * keeps a three-node cluster from producing `a<-b` and `b<-c` — the second of
 * which would try to delete `b` a second time and match nothing.
 *
 * The survivor is the node with more facts: `PREDICATE_MERGE_CYPHER` moves the
 * loser's edges onto the winner, so keeping the busier node moves fewer of them.
 */
export function selectMergePairs(
  candidates: MergeCandidate[],
  threshold: number,
): MergePair[] {
  const usable = candidates.filter(
    (candidate) => candidate.embedding !== null && candidate.embedding.length > 0,
  );

  const ordered = [...usable].sort((a, b) => {
    const byCount = (b.factCount ?? 0) - (a.factCount ?? 0);
    if (byCount !== 0) return byCount;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const spent = new Set<string>();
  const pairs: MergePair[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const keep = ordered[i];
    if (spent.has(keep.id)) continue;

    for (let j = i + 1; j < ordered.length; j += 1) {
      const dup = ordered[j];
      if (spent.has(dup.id)) continue;
      if (cosine(keep.embedding!, dup.embedding!) < threshold) continue;

      pairs.push({ keepId: keep.id, dupId: dup.id });
      spent.add(keep.id);
      spent.add(dup.id);
      break;
    }
  }

  return pairs;
}
