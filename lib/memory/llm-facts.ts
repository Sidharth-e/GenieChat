import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { normalizePredicate } from "./canonicalize";
import type { ExtractedFact } from "./facts";

/**
 * The model call and the schema it is held to, deliberately without a
 * `"server-only"` guard.
 *
 * `scripts/sweep-memories.ts` is the sweep, and a guarded import does not
 * resolve under `tsx` — so the module both the store and the sweep share cannot
 * be guarded. Unlike `graph-store.ts` this leaks nothing: it holds no
 * connection, reads no config, and takes its model as an argument.
 */

export const FACT_EXTRACTION_PROMPT = `You turn one remembered sentence into facts.

A fact is a triple: subject, predicate, object. Write predicates as short plain
verb phrases ("works as", "lives in", "prefers") — not uppercase, not snake_case.

Rules:
- The subject and the object must both appear in the sentence. Never introduce a
  name, place, product or organisation the sentence does not contain.
- The user is the subject when the sentence is about them: use the literal
  subject "user".
- A literal that is not a thing — an instruction, a preference expressed as a
  value — takes objectKind "value". Everything else is "entity".
- Set operation to "replace" only when the sentence says the old value is no
  longer true ("now", "no longer", "used to", "I moved to"). Otherwise omit it.
- One sentence usually carries more than one fact ("Rust dev at Acme in
  Bangalore" is three). Return all of them.
- If the sentence asserts nothing durable, return an empty list. An empty list
  is a valid answer; an invented fact is not.

Reply with a single JSON object and nothing else — no prose, no explanation, no
markdown fence — in exactly this shape:
{"facts":[{"subject":"user","predicate":"works as","object":"Rust developer",
           "objectKind":"entity","operation":"add","confidence":0.9}]}`;

/**
 * What the provider's structured-output layer validates against. This and
 * `parseFactExtraction` both exist on purpose: this one is the schema the model
 * is *told* about, the parser is the boundary that holds when a provider ignores
 * it — which `ChatOllama` has been observed to do.
 *
 * `operation` defaults to `"add"` here as well as in the parser, because the
 * default is the safety property: silence from the model must never close a
 * fact.
 */
export const factExtractionInputSchema = z.object({
  facts: z
    .array(
      z.object({
        subject: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
        objectKind: z.enum(["entity", "value"]),
        operation: z.enum(["add", "replace"]).default("add"),
        confidence: z.number().min(0).max(1).default(0.5),
      }),
    )
    .default([]),
});

/**
 * The one subject the containment guard exempts: the prompt tells the model to
 * name the person themself `"user"`, and that word is not in the sentence, so
 * requiring it there would drop every personal fact. The guard exists to stop a
 * model inventing *someone else*, which is why the exemption is this exact
 * literal and never applies to the object.
 */
const USER_SUBJECT = "user";

/**
 * One extraction, validated. `null` means the model answered with something the
 * schema refuses — never a throw and never a repair, because a guessed fact is
 * worse than a missing one. An unreachable model throws, which is how a caller
 * tells the two apart.
 *
 * A validated response is still filtered: a triple naming something the sentence
 * does not contain is dropped, and so is one whose predicate normalizes to
 * nothing. Both are the model's failure, not the user's, so they are silent —
 * the returned list may legitimately be shorter than the model's, or empty.
 */
export function parseFactExtraction(
  raw: unknown,
  sourceText: string,
): ExtractedFact[] | null {
  const parsed = factExtractionInputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const haystack = sourceText.toLowerCase();

  return parsed.data.facts
    .map((fact) => ({ ...fact, predicate: normalizePredicate(fact.predicate) }))
    .filter((fact) => fact.predicate !== "")
    .filter(
      (fact) =>
        (fact.subject.trim().toLowerCase() === USER_SUBJECT ||
          haystack.includes(fact.subject.toLowerCase())) &&
        haystack.includes(fact.object.toLowerCase()),
    )
    .map((fact) => ({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      objectKind: fact.objectKind,
      operation: fact.operation,
      confidence: fact.confidence,
    }));
}

export async function extractFacts(
  model: BaseChatModel,
  sourceText: string,
  knownPredicates: string[],
): Promise<ExtractedFact[] | null> {
  const structured = model.withStructuredOutput(factExtractionInputSchema, {
    name: "memory_fact_extraction",
  });

  const raw = await structured.invoke([
    { role: "system", content: FACT_EXTRACTION_PROMPT },
    { role: "user", content: buildRequest(sourceText, knownPredicates) },
  ]);

  return parseFactExtraction(raw, sourceText);
}

function buildRequest(sourceText: string, knownPredicates: string[]): string {
  return [
    `Sentence:\n${sourceText}`,
    // A hint, not an instruction: reusing a canonical verb keeps the predicate
    // vocabulary from growing a synonym per phrasing, and costs one line.
    knownPredicates.length > 0
      ? `Predicates already in this user's graph (reuse one when it fits):\n${knownPredicates.join(", ")}`
      : "No existing predicates for this user yet.",
  ].join("\n\n");
}
