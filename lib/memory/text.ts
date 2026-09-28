/**
 * Pure text primitives for memory extraction and recall, lifted out of the
 * store class that used to hold them, where they sat beside IO and could not
 * be tested.
 *
 * Two of the functions below are shaped differently from their originals; the
 * arithmetic is the same, the container is not. `extractFeatures` takes text
 * rather than tokens, and the concept space is a dense array over an explicitly
 * built space rather than a sparse `Map` over a corpus. Both follow from the
 * per-pair scoring the graph needs: the original built its concept space over
 * *every memory the user had*, which is the whole-corpus load the graph
 * replaces. A space built from just the texts being compared removes that
 * dependency, and a dense array keeps the two vectors in one shared dimension
 * order without carrying a feature index around.
 */
import { logger } from "@/lib/logger";
import {
  MEMORY_MAX_CONCEPT_FEATURES,
  MEMORY_MAX_QUERY_CHARS,
  MEMORY_MIN_TOKEN_LENGTH,
  MEMORY_QUERY_SEPARATOR,
  MEMORY_STOPWORDS,
} from "@/constants/memory";

export function tokenizeToArray(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false;
      if (token.length < MEMORY_MIN_TOKEN_LENGTH) return false;
      if (MEMORY_STOPWORDS.has(token)) return false;
      return true;
    });
}

export function tokenize(text: string): Set<string> {
  return new Set(tokenizeToArray(text));
}

export function lexicalSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap++;
    }
  }

  if (overlap === 0) return 0;
  return overlap / Math.sqrt(a.size * b.size);
}

/**
 * Highest-scoring items first, capped at `limit`. Generic over the item so the
 * caller keeps its own shape — edges, memories and scored pairs all need this.
 */
export function takeTopScores<T>(
  items: T[],
  score: (item: T) => number,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/**
 * Unigrams plus adjacent-token bigrams, capped at `MEMORY_MAX_CONCEPT_FEATURES`.
 * The cap is applied here rather than only at weighting time so an unbounded
 * text cannot produce an unbounded feature list.
 *
 * The truncation is positional, so a text longer than the cap keeps its leading
 * unigrams and loses its bigrams — the source trimmed by weight instead, but
 * weights need an IDF space this function does not have. Memories are a
 * sentence or two, so the cap is rarely reached; a long one loses bigram signal
 * rather than failing.
 */
export function extractFeatures(text: string): string[] {
  const tokens = tokenizeToArray(text);
  const features: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    features.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return features.slice(0, MEMORY_MAX_CONCEPT_FEATURES);
}

/**
 * IDF per feature over the supplied texts. The map's insertion order is the
 * dimension order of every vector built against it, so the same space must be
 * used for all vectors that will be compared.
 */
export function buildConceptSpace(texts: string[]): Map<string, number> {
  const featureSets = texts.map((text) => new Set(extractFeatures(text)));

  const documentFrequency = new Map<string, number>();
  for (const featureSet of featureSets) {
    for (const feature of featureSet) {
      documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1);
    }
  }

  const totalDocs = Math.max(featureSets.length, 1);
  const space = new Map<string, number>();
  for (const [feature, df] of documentFrequency.entries()) {
    space.set(feature, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }

  return space;
}

/**
 * TF-IDF weights for `features`, L2-normalized and laid out in `space`'s
 * dimension order. Returns `[]` when the text has no weight at all, which the
 * similarity function treats as "no vector" rather than as an all-zero one.
 */
export function buildConceptVector(
  features: string[],
  space: Map<string, number>,
): number[] {
  if (features.length === 0 || space.size === 0) return [];

  const termFrequency = new Map<string, number>();
  for (const feature of features) {
    termFrequency.set(feature, (termFrequency.get(feature) ?? 0) + 1);
  }

  const trimmed = takeTopScores(
    [...termFrequency.entries()].map(([feature, count]) => ({
      feature,
      // A feature the space never saw gets a neutral weight rather than the
      // source's corpus-derived default, which is not recoverable from a bare
      // `Map`. It is unreachable in practice: callers build the space from a
      // superset of the features they go on to vectorize.
      weight: (1 + Math.log(count)) * (space.get(feature) ?? 1),
    })),
    (entry) => entry.weight,
    MEMORY_MAX_CONCEPT_FEATURES,
  );

  const norm = Math.sqrt(
    trimmed.reduce((sum, entry) => sum + entry.weight * entry.weight, 0),
  );
  if (!Number.isFinite(norm) || norm === 0) return [];

  const normalized = new Map(
    trimmed.map((entry) => [entry.feature, entry.weight / norm]),
  );

  return [...space.keys()].map((feature) => normalized.get(feature) ?? 0);
}

/**
 * Cosine of two vectors from the same space, clamped to [0, 1]. Different
 * widths mean the two did not come from one space: that is not comparable, and
 * a partial dot product across misaligned dimensions would return a plausible
 * wrong number rather than an obvious one.
 */
export function conceptSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }

  return Math.max(0, Math.min(1, dot));
}

export function normalizeQueryForRetrieval(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length <= MEMORY_MAX_QUERY_CHARS) {
    return normalized;
  }

  const headBudget = Math.floor(
    (MEMORY_MAX_QUERY_CHARS - MEMORY_QUERY_SEPARATOR.length) * 0.3,
  );
  const tailBudget =
    MEMORY_MAX_QUERY_CHARS - MEMORY_QUERY_SEPARATOR.length - headBudget;
  const trimmed = `${normalized.slice(0, headBudget)}${MEMORY_QUERY_SEPARATOR}${normalized.slice(-tailBudget)}`;

  logger.warn(
    `[Memory] Retrieval query truncated from ${normalized.length} to ${trimmed.length} characters`,
  );

  return trimmed;
}
