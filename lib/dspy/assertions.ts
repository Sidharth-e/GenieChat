/**
 * Error thrown when a DSPy assertion fails.
 * Triggers a retry with the constraint message appended to the prompt as feedback.
 */
export class DSPyAssertionError extends Error {
  constructor(
    message: string,
    public readonly constraint: string,
  ) {
    super(message);
    this.name = "DSPyAssertionError";
  }
}

/**
 * Hard constraint on module output.
 * If the condition is false, throws DSPyAssertionError which triggers a retry
 * with the constraint message added to the prompt.
 *
 * Usage inside a validate callback:
 * ```ts
 * await summarizer.forward({ text }, {
 *   validate: (result) => {
 *     Assert(result.summary.length > 50, "Summary must be at least 50 characters");
 *     Assert(result.summary.length < 500, "Summary must be under 500 characters");
 *   }
 * });
 * ```
 */
export function Assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new DSPyAssertionError(message, message);
  }
}

interface SuggestionRecord {
  message: string;
  timestamp: number;
}

const suggestionLog: SuggestionRecord[] = [];

/**
 * Soft constraint on module output.
 * If the condition is false, records the failure for potential use in optimization
 * but does not throw or trigger a retry.
 * Returns whether the condition passed.
 */
export function Suggest(condition: boolean, message: string): boolean {
  if (!condition) {
    suggestionLog.push({ message, timestamp: Date.now() });
    return false;
  }
  return true;
}

/**
 * Retrieve and clear all recorded suggestion failures.
 * Useful for optimization passes that want to learn from soft constraint violations.
 */
export function drainSuggestions(): SuggestionRecord[] {
  return suggestionLog.splice(0);
}
