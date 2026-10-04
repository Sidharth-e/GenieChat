/**
 * The fixed probe set behind `pnpm memory:eval`.
 *
 * Each case is the state a sweep leaves behind — a set of facts — plus a
 * question and the facts recall must return, and optionally the facts it must
 * **not**. `reject` is what makes the set worth running: a precision failure is
 * invisible to a "did the right thing come back" check, and an irrelevant fact
 * crowding the prompt is the failure a user actually notices.
 *
 * A fact is written as a triple rather than a sentence, because the graph this
 * seeds is the *post-sweep* state and a sweep is what turns a sentence into a
 * triple. Extraction is not what this harness measures — `pnpm memory:check` and
 * `tests/lib/memory/llm-facts.test.ts` cover that — and seeding sentences here
 * would mean running the extractor, which is a model call per case and a
 * different measurement on every run.
 *
 * The cases are deliberately not tuned to the current thresholds. If they were,
 * they would encode the answer instead of testing it, and the set could never
 * tell anyone a threshold is wrong.
 *
 * `expect` is a plain string array rather than a regex or a matcher, and the
 * comparison is a case-insensitive substring test: the assertion has to be
 * readable from the case itself, or the set becomes something only its author
 * can interpret.
 */
export interface EvalFact {
  /** The sentence the fact came from — what recall renders and what is embedded. */
  text: string;
  /** `"user"` is the anchor; anything else is an `:Entity` surface form. */
  subject: string;
  predicate: string;
  object: string;
  /** false = the graph closed it, which is the state a supersede leaves. */
  current?: boolean;
}

export interface EvalCase {
  name: string;
  facts: EvalFact[];
  query: string;
  /**
   * Substrings that must appear in the returned text, case-insensitive.
   * Optional, because a case may assert *only* what must not come back — an
   * unrelated question is answered correctly by returning nothing.
   */
  expect?: string[];
  /** Substrings that must NOT appear at all. */
  reject?: string[];
  /**
   * Substrings that must not appear **as the current claim**.
   *
   * A superseded fact is deliberately rendered as dated history (§8.6) —
   * "works as Rust now (previously: works as Swift, until 2026-10)" — so a
   * plain substring test cannot tell a fact served as current from one labelled
   * as past, and would report the design's own history feature as a staleness
   * failure. This arm strips `(previously: …)` before matching, which is what
   * makes the assertion discriminate the regression it names.
   */
  rejectCurrent?: string[];
}

export const MEMORY_EVAL_CASES: EvalCase[] = [
  {
    name: "recalls a stated preference",
    facts: [
      {
        text: "I really like apple products",
        subject: "user",
        predicate: "likes",
        object: "apple",
      },
    ],
    query: "what brands do I like",
    expect: ["apple"],
  },
  {
    name: "does not serve a superseded fact as current",
    facts: [
      {
        text: "I work as a Swift developer",
        subject: "user",
        predicate: "works as",
        object: "Swift developer",
        current: false,
      },
      {
        text: "I work as a Rust developer now",
        subject: "user",
        predicate: "works as",
        object: "Rust developer",
      },
    ],
    query: "what do I work as",
    expect: ["Rust"],
    // "Swift" legitimately comes back as dated history. What must never happen
    // is that it comes back as the current claim — which is what dropping
    // `isCurrent` from the seed statement would do.
    rejectCurrent: ["Swift developer"],
  },
  {
    name: "keeps both values of a multi-valued predicate",
    facts: [
      { text: "I like apples", subject: "user", predicate: "likes", object: "apple" },
      { text: "I like bananas", subject: "user", predicate: "likes", object: "banana" },
    ],
    query: "what fruit do I like",
    expect: ["apple", "banana"],
  },
  {
    // The harness seeds the facts below directly, so this cannot be about
    // idempotency no matter what it is called — it asserts that a first-person
    // fact is recallable by name. Duplicate saves are covered where they
    // actually happen: `decideFactWrite` in the unit suite, and the
    // re-saved-fact check in `scripts/check-memory.ts`.
    name: "recalls the user's own name",
    facts: [
      { text: "My name is Sidharth", subject: "user", predicate: "named", object: "Sidharth" },
    ],
    query: "what is my name",
    expect: ["Sidharth"],
  },
  {
    name: "traverses from an entity to a related fact",
    facts: [
      { text: "I like apple products", subject: "user", predicate: "likes", object: "apple" },
      {
        text: "Apple makes the MacBook",
        subject: "apple",
        predicate: "makes",
        object: "MacBook",
      },
    ],
    query: "what do I like",
    expect: ["apple"],
  },
  {
    name: "returns nothing for an unrelated question",
    facts: [
      {
        text: "I prefer dark mode",
        subject: "user",
        predicate: "prefers",
        object: "dark mode",
      },
    ],
    query: "what is the capital of France",
    reject: ["dark mode"],
  },
];
