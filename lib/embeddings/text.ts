import {
  EMBEDDING_TOKEN_BUDGET,
  ESTIMATED_CHARS_PER_TOKEN,
  MIN_TRUNCATED_CHARS,
  TRUNCATION_HEAD_RATIO,
  TRUNCATION_SEPARATOR,
} from "@/constants/embeddings";

export interface TruncateOptions {
  budgetTokens?: number;
  charsPerToken?: number;
  separator?: string;
  minAllowedChars?: number;
  headRatio?: number;
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

export function normalizeTextForEmbedding(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Trim to a character allowance, keeping the head preferentially and marking
 * the cut with a separator. The allowance comes from the token budget rather
 * than a tokenizer, so it over-trims prose rather than risking a rejected
 * request.
 *
 * The options exist so the branches below are reachable in tests: with the real
 * constants the allowance is 23808 characters and the separator-only branch can
 * never be hit. Note `allowedChars` deliberately has no floor — a floor would
 * put that branch out of reach again, which is the one thing the options are
 * for. `MIN_TRUNCATED_CHARS` belongs to `shrinkTextForRetry`, below.
 */
export function truncateByEstimatedTokenBudget(
  text: string,
  options: TruncateOptions = {},
): string {
  const budgetTokens = options.budgetTokens ?? EMBEDDING_TOKEN_BUDGET;
  const charsPerToken = options.charsPerToken ?? ESTIMATED_CHARS_PER_TOKEN;
  const separator = options.separator ?? TRUNCATION_SEPARATOR;
  const headRatio = options.headRatio ?? TRUNCATION_HEAD_RATIO;
  const allowedChars = options.minAllowedChars ?? budgetTokens * charsPerToken;

  if (text.length <= allowedChars) return text;

  const contentBudget = allowedChars - separator.length;
  if (contentBudget <= 2) return separator;

  const headBudget = Math.floor(contentBudget * headRatio);
  const tailBudget = contentBudget - headBudget;
  return (
    text.slice(0, headBudget) +
    separator +
    text.slice(text.length - tailBudget)
  );
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

export function isContextLengthError(error: unknown): boolean {
  return /context length|context_length|too many tokens|maximum context/i.test(
    getErrorMessage(error),
  );
}

export function parseContextLengthError(
  error: unknown,
): { limit: number; requested: number } | null {
  const match =
    /maximum context length is\s+(\d+)\s*tokens.*requested\s+(\d+)\s*tokens/i.exec(
      getErrorMessage(error),
    );
  if (!match) return null;

  // A count too large for a double parses to `Infinity`, and returning that
  // would be worse than returning nothing: the caller turns the pair into a
  // shrink ratio, `Infinity / Infinity` is `NaN`, and a `NaN` ratio makes
  // `shrinkTextForRetry` slice the text to `""` -- which would then be embedded
  // and stored as the vector for non-empty content. No provider reports such a
  // number, but the cost of being wrong is a silently wrong vector, so the
  // guard stays.
  const limit = Number(match[1]);
  const requested = Number(match[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(requested)) return null;

  return { limit, requested };
}

/**
 * Cut a text down by a ratio for a retry attempt. Returns null once the text is
 * already at the floor, which is how a caller's retry loop terminates instead of
 * spinning on progressively smaller slices of the same string.
 */
export function shrinkTextForRetry(text: string, ratio = 0.5): string | null {
  const nextLength = Math.max(
    Math.floor(text.length * ratio),
    MIN_TRUNCATED_CHARS,
  );
  if (nextLength >= text.length) return null;
  return text.slice(0, nextLength);
}
