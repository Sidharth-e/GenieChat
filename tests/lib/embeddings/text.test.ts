import { describe, expect, it } from "vitest";
import {
  EMBEDDING_TOKEN_BUDGET,
  ESTIMATED_CHARS_PER_TOKEN,
  TRUNCATION_SEPARATOR,
} from "@/constants/embeddings";
import {
  estimateTokenCount,
  getErrorMessage,
  isContextLengthError,
  normalizeTextForEmbedding,
  parseContextLengthError,
  shrinkTextForRetry,
  truncateByEstimatedTokenBudget,
} from "@/lib/embeddings/text";

describe("estimateTokenCount", () => {
  it("rounds up, so a partial token still costs a token", () => {
    expect(estimateTokenCount("abcd")).toBe(2);
  });

  it("counts the empty string as zero", () => {
    expect(estimateTokenCount("")).toBe(0);
  });
});

describe("normalizeTextForEmbedding", () => {
  it("collapses runs of whitespace", () => {
    expect(normalizeTextForEmbedding("a \n\n\t b")).toBe("a b");
  });

  it("trims the ends", () => {
    expect(normalizeTextForEmbedding("  hello  ")).toBe("hello");
  });
});

describe("truncateByEstimatedTokenBudget", () => {
  it("returns short text untouched", () => {
    expect(truncateByEstimatedTokenBudget("short text")).toBe("short text");
  });

  it("keeps text at exactly the budget with no separator", () => {
    const text = "a".repeat(EMBEDDING_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN);
    expect(truncateByEstimatedTokenBudget(text)).toBe(text);
  });

  it("truncates over-budget text and marks the cut", () => {
    const text = "a".repeat(
      EMBEDDING_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN + 1000,
    );
    const result = truncateByEstimatedTokenBudget(text);
    expect(result).toContain(TRUNCATION_SEPARATOR);
    expect(result.length).toBeLessThan(text.length);
    expect(estimateTokenCount(result)).toBeLessThanOrEqual(
      EMBEDDING_TOKEN_BUDGET,
    );
  });

  it("keeps more of the head than the tail", () => {
    const head = "H".repeat(20_000);
    const tail = "T".repeat(20_000);
    const result = truncateByEstimatedTokenBudget(head + tail);
    const [keptHead, keptTail] = result.split(TRUNCATION_SEPARATOR);
    expect(keptHead.length).toBeGreaterThan(keptTail.length);
    expect(keptHead).toBe("H".repeat(keptHead.length));
    expect(keptTail).toBe("T".repeat(keptTail.length));
  });

  it("returns the separator alone when even the floor exceeds the budget", () => {
    // The default allowance (23808 chars) dwarfs the separator, so this branch
    // is only reachable by shrinking the budget through the options: 1 token at
    // 3 chars/token leaves 3 chars for content against a 5-char separator.
    const result = truncateByEstimatedTokenBudget("x".repeat(5000), {
      budgetTokens: 1,
    });
    expect(result).toBe(TRUNCATION_SEPARATOR);
  });

  it("never returns more characters than the caller allows", () => {
    const text = "y".repeat(10_000);
    const result = truncateByEstimatedTokenBudget(text, {
      budgetTokens: 100,
      minAllowedChars: 4000,
    });
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});

describe("parseContextLengthError", () => {
  it("extracts the limit and the requested count", () => {
    const error = new Error(
      "This model's maximum context length is 8192 tokens. However, you requested 20000 tokens",
    );
    expect(parseContextLengthError(error)).toEqual({
      limit: 8192,
      requested: 20000,
    });
  });

  it("returns null for an unrelated error", () => {
    expect(parseContextLengthError(new Error("boom"))).toBeNull();
  });
});

describe("isContextLengthError", () => {
  it("recognises a context-length failure", () => {
    expect(
      isContextLengthError(new Error("maximum context length exceeded")),
    ).toBe(true);
  });

  it("rejects a network failure", () => {
    expect(isContextLengthError(new Error("ECONNREFUSED"))).toBe(false);
  });
});

describe("shrinkTextForRetry", () => {
  it("cuts proportionally to the ratio it is given", () => {
    const text = "z".repeat(10_000);
    const shrunk = shrinkTextForRetry(text, 0.5);
    expect(shrunk).not.toBeNull();
    expect(shrunk!.length).toBe(5000);
  });

  it("never shrinks below the floor", () => {
    const shrunk = shrinkTextForRetry("z".repeat(100_000), 0.001);
    expect(shrunk!.length).toBeGreaterThanOrEqual(256);
  });

  it("returns null when the text is already at the floor, so callers stop retrying", () => {
    expect(shrinkTextForRetry("z".repeat(256), 0.5)).toBeNull();
  });
});

describe("getErrorMessage", () => {
  it("reads a message off an Error", () => {
    expect(getErrorMessage(new Error("nope"))).toBe("nope");
  });

  it("stringifies a non-Error", () => {
    expect(getErrorMessage("nope")).toBe("nope");
  });
});
