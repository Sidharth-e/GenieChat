/**
 * The deterministic layer: entities and memory-to-memory edges derived from
 * content alone, with no model in the loop. This is what makes the graph useful
 * the instant a memory is written, and what keeps it correct when no model is
 * reachable.
 */
import {
  MEMORY_EDGE_NEIGHBOR_LIMIT,
  MEMORY_EDGE_THRESHOLD,
} from "@/constants/memory";
import {
  buildConceptSpace,
  buildConceptVector,
  conceptSimilarity,
  extractFeatures,
  lexicalSimilarity,
  takeTopScores,
  tokenize,
} from "./text";

const ENTITY_MIN_LENGTH = 2;

/**
 * Carried over from `vector-memory-store.ts:605`, term for term. The
 * same-category bonus that used to sit beside these is gone with the `category`
 * field itself.
 */
const CONCEPT_WEIGHT = 0.34;
const RECENT_PAIR_DAYS = 14;
const RECENT_PAIR_BONUS = 0.06;
const NEAR_PAIR_DAYS = 60;
const NEAR_PAIR_BONUS = 0.03;

/** The fields an edge score is computed from. */
export interface ScorableMemory {
  content: string;
  createdAt?: string;
}

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
 * The tenant-scoping key for entity resolution. Kept as a function so the
 * scoping is one place rather than a convention repeated at every MERGE.
 */
export function entityMergeKey(userId: string, normalizedName: string): string {
  return `${userId}\u0000${normalizedName}`;
}

/** Capitalized token sequences (proper nouns), normalized and deduplicated. */
export function extractEntityNames(content: string): string[] {
  const text = (content ?? "").trim();
  if (!text) return [];

  const names = new Set<string>();

  // Proper-noun runs first: they are the highest-signal candidates.
  for (const match of text.matchAll(
    /\b\p{Lu}[\p{L}\p{N}'’]*(?:\s+\p{Lu}[\p{L}\p{N}'’]*)*/gu,
  )) {
    const name = normalizeEntityName(match[0]);
    if (name.length >= ENTITY_MIN_LENGTH) names.add(name);
  }

  // Then significant unigrams and bigrams that survive the stopword filter.
  const tokens = tokenize(text).size > 0 ? [...tokenize(text)] : [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].length >= ENTITY_MIN_LENGTH) names.add(tokens[index]);
    if (index + 1 < tokens.length) {
      names.add(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }

  names.delete("");
  return [...names];
}

/**
 * How related two memories are, in [0, 1]: token overlap, plus a concept-space
 * cosine, plus a small bonus for having been written close together. Carried
 * over from `vector-memory-store.ts:605`.
 *
 * The early return is load-bearing: without it, two memories written a day
 * apart would be linked by the clock alone even with nothing in common.
 */
export function relationScore(a: ScorableMemory, b: ScorableMemory): number {
  const left = (a.content ?? "").trim();
  const right = (b.content ?? "").trim();
  if (!left || !right) return 0;

  const lexical = lexicalSimilarity(tokenize(left), tokenize(right));

  const space = buildConceptSpace([left, right]);
  const concept = conceptSimilarity(
    buildConceptVector(extractFeatures(left), space),
    buildConceptVector(extractFeatures(right), space),
  );

  if (lexical === 0 && concept === 0) return 0;

  let score = lexical + concept * CONCEPT_WEIGHT;

  const leftMs = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
  const rightMs = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    const diffInDays = Math.abs(leftMs - rightMs) / (1000 * 60 * 60 * 24);
    if (diffInDays <= RECENT_PAIR_DAYS) {
      score += RECENT_PAIR_BONUS;
    } else if (diffInDays <= NEAR_PAIR_DAYS) {
      score += NEAR_PAIR_BONUS;
    }
  }

  return Math.min(score, 1);
}

/** Above-threshold neighbours, best first, capped at the neighbour limit. */
export function buildDeterministicEdges<T extends ScorableMemory & { id: string }>(
  memory: T,
  others: T[],
): { id: string; score: number }[] {
  if (!(memory.content ?? "").trim()) return [];

  const scored = others
    .filter((other) => other.id !== memory.id)
    .map((other) => ({ id: other.id, score: relationScore(memory, other) }))
    .filter((edge) => edge.score >= MEMORY_EDGE_THRESHOLD);

  return takeTopScores(scored, (edge) => edge.score, MEMORY_EDGE_NEIGHBOR_LIMIT);
}
