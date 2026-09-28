/** The index contract. Must match the configured OLLAMA_EMBEDDING_MODEL's width. */
export const EMBEDDING_DIMENSIONS = 768;

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
