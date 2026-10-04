/**
 * The deterministic layer: entities and memory-to-memory edges derived from
 * content alone, with no model in the loop. This is what makes the graph useful
 * the instant a memory is written, and what keeps it correct when no model is
 * reachable.
 */
import {
  ENTITY_COMMON_WORDS,
  MEMORY_EDGE_NEIGHBOR_LIMIT,
  MEMORY_EDGE_THRESHOLD,
} from "@/constants/memory";
import { normalizeEntityName } from "./canonicalize";
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

/** A run of one or more capitalized tokens — the highest-signal candidates. */
const PROPER_NOUN_RUN =
  /\b\p{Lu}[\p{L}\p{N}'’]*(?:\s+\p{Lu}[\p{L}\p{N}'’]*)*/gu;

/**
 * Whether the text before `index` ends a sentence, so the run at `index` is the
 * first thing in one.
 *
 * Capitalization is only evidence of a proper noun when it is a *choice*. The
 * first word of a sentence is capitalized whether or not it names anything, so
 * position has to cancel the signal — otherwise "All the apple products are
 * cool" names `all` as an entity, which is exactly what it did.
 */
function startsSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd();
  if (!before) return true;
  return /[.!?\n]$/.test(before);
}

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
 * The tenant-scoping key for entity resolution. Kept as a function so the
 * scoping is one place rather than a convention repeated at every MERGE.
 */
export function entityMergeKey(userId: string, normalizedName: string): string {
  return `${userId}\u0000${normalizedName}`;
}

/**
 * Capitalized token sequences (proper nouns) plus significant unigrams,
 * normalized and deduplicated.
 *
 * Both passes are deliberately conservative, because a node that names nothing
 * is worse than a node that is missing: entities are what link one memory to
 * another, so a junk entity competes with the real concept for the same span of
 * text and stops two memories about the same thing from ever sharing a node.
 * The bigram pass that used to run here — every adjacent token pair — was the
 * worst offender, turning one sentence into nine nodes of which one was real.
 */
export function extractEntityNames(content: string): string[] {
  const text = (content ?? "").trim();
  if (!text) return [];

  const names = new Set<string>();

  // Proper-noun runs first: they are the highest-signal candidates.
  for (const match of text.matchAll(PROPER_NOUN_RUN)) {
    // A run opening a sentence loses its first token, not the whole run: in
    // "All Apple products are cool" the noise is `All`, while `Apple` is the
    // thing worth keeping. A run that does not open a sentence is untouched.
    const raw = startsSentence(text, match.index)
      ? match[0].replace(/^\S+\s*/, "")
      : match[0];
    const name = normalizeEntityName(raw);
    if (name.length >= ENTITY_MIN_LENGTH) names.add(name);
  }

  // Then significant unigrams, minus the filler.
  for (const token of tokenize(text)) {
    if (ENTITY_COMMON_WORDS.has(token)) continue;
    names.add(token);
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
