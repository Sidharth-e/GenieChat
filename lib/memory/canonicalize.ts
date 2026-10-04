import { FUNCTIONAL_PREDICATES } from "@/constants/memory";

/**
 * Canonicalization, pure and deterministic: the two functions that turn a
 * surface form into the string a uniqueness constraint keys on, one for each
 * side of a triple.
 *
 * The model emits surface forms ("is made by", "Acme Corp"); these turn them
 * into the strings the `(userId, canonicalName)` and `(userId, normalizedName)`
 * constraints key on.
 *
 * Deliberately no `"server-only"` guard: `scripts/check-memory.ts` and
 * `scripts/eval-memory.ts` import it under `tsx`.
 */

/**
 * Lowercase, collapse whitespace, drop a possessive, strip surrounding
 * punctuation. Returns "" when nothing survives — and callers must treat "" as
 * "no entity", never as a name. An empty normalizedName would MERGE every
 * user's punctuation into one shared node.
 */
export function normalizeEntityName(raw: string): string {
  return (raw ?? "")
    .replace(/[’']s\b/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The predicate half of canonicalization.
 *
 * The model emits surface forms ("is made by", "PRODUCT_OF"); this turns them
 * into the one string the `(userId, canonicalName)` constraint keys on. Keeping
 * it deterministic is what makes canonicalization stable across extraction-model
 * changes — and unit-testable.
 *
 * Deliberately no `"server-only"` guard: `scripts/check-memory.ts` and
 * `scripts/eval-memory.ts` import it under `tsx`.
 */

/**
 * `UPPER_SNAKE`, with separators collapsed. Case-folding happens before the
 * strip so an accented capital folds correctly; `\p{L}` keeps non-ASCII letters
 * rather than deleting them, which a naive `[^a-z0-9]` strip would do to every
 * non-English predicate.
 *
 * Returns `""` for input with no letters or digits. Callers must treat that as
 * "no predicate" and drop the triple — an empty canonical name would be a
 * single node every malformed extraction merged into.
 */
export function normalizePredicate(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .split(" ")
    .filter(Boolean)
    .join("_")
    .toUpperCase();
}

/**
 * Predicates are embedded in a template, not as bare two-word strings: the
 * relation is the meaning, and "made by" and "made for" share every token while
 * asserting different things. `X ... Y` puts both arguments in the comparison.
 */
export function predicateEmbeddingText(canonicalName: string): string {
  return `X ${canonicalName.replace(/_/g, " ").toLowerCase()} Y`;
}

export function isFunctionalPredicate(canonicalName: string): boolean {
  return (FUNCTIONAL_PREDICATES as readonly string[]).includes(canonicalName);
}

/**
 * The best candidate at or above the threshold, or null.
 *
 * At-or-above rather than strictly-above so a threshold of `t` means "similarity
 * t suffices", which is what the constant's comment promises. Ties resolve to
 * the first in order, so the caller controls the tiebreak by ordering the read.
 */
export function selectCanonicalMatch<T extends { score: number }>(
  candidates: T[],
  threshold: number,
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate.score < threshold) continue;
    if (best === null || candidate.score > best.score) best = candidate;
  }
  return best;
}
