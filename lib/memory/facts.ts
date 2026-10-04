import { isFunctionalPredicate } from "./canonicalize";
import type { RecallCandidate } from "./recall";

/**
 * The fact model and the two decisions the write and read paths turn on, pure
 * and deterministic — so the "did the graph do the right thing" questions are
 * unit tests rather than Neo4j inspections.
 *
 * No `"server-only"` guard: the check and eval scripts import it under `tsx`.
 */

export type FactOperation = "add" | "replace";
export type FactObjectKind = "entity" | "value";

/** One triple as the extractor produced it, before any resolution. */
export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  objectKind: FactObjectKind;
  operation: FactOperation;
  confidence: number;
}

export type FactWriteDecision = "noop" | "supersede" | "insert";

/**
 * What to do with an incoming triple, given the `(S, P, *)` facts already
 * current. Exact identity, because canonicalization resolved both ends first —
 * the object ids compared here are node ids, not strings.
 *
 * The ordering is the whole design:
 *   1. the same object is already current -> nothing to do, so a repeated
 *      sentence is idempotent;
 *   2. something else is current and either the extractor saw a temporal cue or
 *      the predicate is functional -> close the old;
 *   3. otherwise insert beside it.
 *
 * Step 2's `operation` gate is what keeps "likes apple" and "likes banana"
 * alive together. The `FUNCTIONAL_PREDICATES` arm is what keeps "works as
 * Swift" from surviving a move to Rust when the extractor stayed silent.
 *
 * `currentFacts` must hold only facts that are still current: a closed fact is
 * not a thing to close, and the caller owns that filter.
 */
export function decideFactWrite(input: {
  predicate: string;
  operation: FactOperation;
  incomingObjectId: string;
  currentFacts: { objectId: string }[];
}): FactWriteDecision {
  const { predicate, operation, incomingObjectId, currentFacts } = input;

  if (currentFacts.some((fact) => fact.objectId === incomingObjectId)) {
    return "noop";
  }

  if (currentFacts.length === 0) {
    return "insert";
  }

  if (operation === "replace" || isFunctionalPredicate(predicate)) {
    return "supersede";
  }

  return "insert";
}

/**
 * The reconciliation sweep's decision: among facts sharing `(S, P)`, everything
 * but the newest is stale. Returns the ids to close, in input order, and never
 * mutates the input.
 *
 * A tie on `createdAt` keeps the first in input order, which the caller makes
 * deterministic by ordering its read by `createdAt ASC`.
 */
export function selectSuperseded(
  facts: { id: string; createdAt: string }[],
): string[] {
  if (facts.length < 2) return [];

  let newest = facts[0];
  for (const fact of facts) {
    if (fact.createdAt > newest.createdAt) newest = fact;
  }

  return facts.filter((fact) => fact.id !== newest.id).map((fact) => fact.id);
}

/**
 * A fact row as the ranker wants it. `rankRecall` was written against prose
 * memories; a fact's `sourceText` is its content and it has no separate
 * `updatedAt`, so this is the whole translation and `recall.ts` needs no change.
 */
export function toRecallCandidate(row: {
  id: string;
  sourceText: string;
  createdAt: string;
  vectorScore: number;
  hops: number;
  pathWeight: number;
}): RecallCandidate {
  return {
    id: row.id,
    content: row.sourceText,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    vectorScore: row.vectorScore,
    hops: row.hops,
    pathWeight: row.pathWeight,
  };
}

/**
 * How a fact reaches the prompt: the sentence it came from, never the flattened
 * triple — the wording carries what the relation labels drop.
 *
 * The predecessor is rendered as *past* and dated, because a fact the graph
 * closed is still true of an earlier period and a model that reads "Swift"
 * undated will answer as if it were current.
 */
export function renderRecalledFact(
  text: string,
  predecessor: { sourceText: string; validTo: string } | null,
): string {
  if (!predecessor) return text;

  // `validTo` is an ISO 8601 string, so the first seven characters are the
  // month. Anything shorter or unparseable gets the fact without a date rather
  // than a truncated one.
  const until = predecessor.validTo.slice(0, 7);
  const dated = /^\d{4}-\d{2}$/.test(until);

  return dated
    ? `${text} (previously: ${predecessor.sourceText}, until ${until})`
    : `${text} (previously: ${predecessor.sourceText})`;
}
