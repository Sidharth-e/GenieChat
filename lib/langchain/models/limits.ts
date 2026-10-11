/**
 * Input budgets a model entry declares.
 *
 * Deliberately the leaf of the module: every provider list reads these and
 * nothing here reads a list, so the provider modules and the file that
 * assembles them can import it without a cycle.
 */
export const INPUT_LIMITS = {
  large: 120_000,
  standard: 100_000,
  compact: 80_000,
} as const;

export const DEFAULT_MAX_INPUT_CHARS = INPUT_LIMITS.standard;
