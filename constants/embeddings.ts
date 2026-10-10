export const EMBEDDING_DIMENSIONS = 2048;

/**
 * The embedding model the app reaches when `OPENROUTER_EMBEDDING_MODEL` is
 * unset. It lives here rather than only in `lib/env.ts`'s schema because the
 * `scripts/` checks talk to OpenRouter themselves — they are `tsx` runners that
 * cannot import `lib/env.ts` or the `"server-only"` `lib/config.ts` — and a
 * fallback copied into each of them would be a second model id to keep in step,
 * at a width that has to match `EMBEDDING_DIMENSIONS` above.
 */
export const DEFAULT_EMBEDDING_MODEL = "nvidia/nemotron-3-embed-1b:free";

export const EMBEDDING_MAX_INPUT_TOKENS = 8192;
export const EMBEDDING_TOKEN_SAFETY_MARGIN = 256;
export const EMBEDDING_TOKEN_BUDGET =
  EMBEDDING_MAX_INPUT_TOKENS - EMBEDDING_TOKEN_SAFETY_MARGIN;

/**
 * Deliberately crude and deliberately conservative: 3 chars/token under-counts
 * prose, so the budget trims earlier than strictly necessary. Over-trimming
 * costs a little context; under-trimming costs a failed request.
 */
export const ESTIMATED_CHARS_PER_TOKEN = 3;

/** Head is kept preferentially; the tail is trimmed second. */
export const TRUNCATION_HEAD_RATIO = 0.7;

export const TRUNCATION_SEPARATOR = "\n...\n";

/** Floor for a retry-trimmed text, so shrinking cannot loop down to nothing. */
export const MIN_TRUNCATED_CHARS = 256;
