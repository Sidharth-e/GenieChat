import { Metric } from "./types";

/**
 * Exact match on all output fields.
 * Returns 1 if every field in the expected output matches the prediction, 0 otherwise.
 */
export function exactMatch<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(): Metric<TInput, TOutput> {
  return (example, prediction) => {
    const expected = example.outputs as Record<string, unknown>;
    const actual = prediction as Record<string, unknown>;
    for (const key of Object.keys(expected)) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
        return 0;
    }
    return 1;
  };
}

/**
 * Exact match on a specific output field.
 */
export function fieldExactMatch<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(fieldName: string): Metric<TInput, TOutput> {
  return (example, prediction) => {
    const expected = (example.outputs as Record<string, unknown>)[fieldName];
    const actual = (prediction as Record<string, unknown>)[fieldName];
    return JSON.stringify(actual) === JSON.stringify(expected) ? 1 : 0;
  };
}

/**
 * Word-overlap (Jaccard) similarity on a string field.
 * Words shorter than 3 characters are ignored.
 */
export function fuzzyMatch<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(fieldName: string): Metric<TInput, TOutput> {
  return (example, prediction) => {
    const expected = String(
      (example.outputs as Record<string, unknown>)[fieldName] ?? "",
    )
      .toLowerCase()
      .trim();
    const actual = String(
      (prediction as Record<string, unknown>)[fieldName] ?? "",
    )
      .toLowerCase()
      .trim();
    if (!expected || !actual) return 0;
    if (expected === actual) return 1;

    const expectedWords = new Set(
      expected.split(/\s+/).filter((w) => w.length > 2),
    );
    const actualWords = new Set(
      actual.split(/\s+/).filter((w) => w.length > 2),
    );
    const intersection = new Set(
      [...expectedWords].filter((w) => actualWords.has(w)),
    );
    const union = new Set([...expectedWords, ...actualWords]);
    return union.size > 0 ? intersection.size / union.size : 0;
  };
}

/**
 * Checks if a string field contains all specified keywords.
 * Score = fraction of keywords found.
 */
export function containsKeywords<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(fieldName: string, keywords: string[]): Metric<TInput, TOutput> {
  return (_, prediction) => {
    if (keywords.length === 0) return 1;
    const value = String(
      (prediction as Record<string, unknown>)[fieldName] ?? "",
    ).toLowerCase();
    const found = keywords.filter((k) => value.includes(k.toLowerCase()));
    return found.length / keywords.length;
  };
}

/**
 * Checks if a string field's length is within [min, max].
 * Returns 1 when in range, degrades proportionally outside.
 */
export function lengthBetween<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(fieldName: string, min: number, max: number): Metric<TInput, TOutput> {
  return (_, prediction) => {
    const value = String(
      (prediction as Record<string, unknown>)[fieldName] ?? "",
    );
    if (value.length >= min && value.length <= max) return 1;
    if (value.length < min) return min > 0 ? value.length / min : 0;
    return max > 0 ? max / value.length : 0;
  };
}

/**
 * Compose multiple metrics with weights into a single metric.
 * Final score = weighted average.
 */
export function composeMetrics<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(
  weighted: { metric: Metric<TInput, TOutput>; weight: number }[],
): Metric<TInput, TOutput> {
  return async (example, prediction, trace) => {
    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    if (totalWeight === 0) return 0;
    let weightedSum = 0;
    for (const { metric, weight } of weighted) {
      const score = await metric(example, prediction, trace);
      weightedSum += score * weight;
    }
    return weightedSum / totalWeight;
  };
}
