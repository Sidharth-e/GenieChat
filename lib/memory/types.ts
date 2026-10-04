/**
 * The fact-graph recall types. The graph view's `:Memory` row shape is declared
 * in `graph-view.ts` itself, so nothing about it is duplicated here.
 */

/** How recall answered. `graph` means expansion contributed; `vector` means seeds only. */
export type FactRecallMode = "graph" | "vector";

/**
 * One recalled item, whether it is a materialized fact or a sentence still
 * waiting to be extracted.
 *
 * The `kind` is not decoration: a capture has no subject, predicate or object,
 * so anything that renders a fact's structure has to branch, and a bare `text`
 * would make that branch invisible at the call site.
 */
export interface RecalledFact {
  id: string;
  kind: "fact" | "capture";
  text: string;
  createdAt: string;
}

/**
 * Counts, each of which can be non-zero. `seedCount` is what the index
 * returned, `expandedCount` what the traversal added, `totalCandidates` what was
 * ranked. There is no lexical count because there is no lexical recall arm.
 */
export interface FactRecallMetadata {
  mode: FactRecallMode;
  seedCount: number;
  expandedCount: number;
  totalCandidates: number;
}

export interface FactRecallResult {
  facts: RecalledFact[];
  metadata: FactRecallMetadata;
}

/**
 * What one sweep pass did for one user. Every count can be zero, and a pass
 * where all four are zero is the ordinary case rather than a failure: it means
 * the user had nothing pending.
 */
export interface SweepSummary {
  captures: number;
  reconciled: number;
  merged: number;
  embedded: number;
}
