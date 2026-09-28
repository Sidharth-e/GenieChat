import * as z from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MEMORY_LLM_EDGE_TYPES } from "@/constants/memory";
import { parseEnrichment, type Enrichment } from "./enrichment-schema";

/**
 * The model call and the schema it is held to, deliberately without a
 * `"server-only"` guard.
 *
 * `scripts/enrich-memories.ts` is the sweep, and a guarded import does not
 * resolve under `tsx` — so the module that both the store and the sweep must
 * share cannot be guarded. Unlike `graph-store.ts` this leaks nothing: it holds
 * no connection, reads no config, and takes its model as an argument. The
 * caller supplies the model, which is where the provider wiring stays.
 */

export const MEMORY_EXTRACTION_PROMPT = `You extract a knowledge graph from a single memory.

Return entities (people, organizations, places, projects, products, concepts),
relations between those entities, and edges from this memory to other memories
you are shown.

Only use these memory edge types: RELATES_TO, SUPERSEDES, CONTRADICTS.
SUPERSEDES and CONTRADICTS require real semantic judgment — if you are unsure,
omit the edge rather than guessing. An omitted edge is fine; a wrong one is not.
Entity names must be non-empty and must appear in the memory text.

Reply with a single JSON object and nothing else — no prose, no explanation, no
markdown fence — in exactly this shape:
{"entities":[{"name":"...","type":"..."}],
 "relations":[{"from":"...","to":"...","type":"..."}],
 "memoryEdges":[{"targetId":"...","type":"RELATES_TO","reason":"..."}]}`;

/**
 * What the provider's structured-output layer validates against, before
 * `parseEnrichment` gets its hands on the result. Both exist on purpose: this
 * one is the schema the model is *told* about, and the parser is the boundary
 * that holds when a provider ignores it. The edge type is the shared constant,
 * so the allow-list cannot drift between the two.
 *
 * A live run found the "told about" half is doing real work here, not
 * decoration: `ChatOllama` builds `withStructuredOutput` around a JSON schema
 * passed through `withConfig({ format })`, and the model behind
 * `MEMORY_EXTRACTION_MODEL` answered the long form of this prompt in prose —
 * headings and dashes, no JSON at all — so nothing reached the parser. For
 * every provider this must hold for, the shape therefore also appears in
 * `MEMORY_EXTRACTION_PROMPT` as text.
 */
export const extractionInputSchema = z.object({
  entities: z.array(
    z.object({ name: z.string().min(1), type: z.string().min(1) }),
  ),
  relations: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        type: z.string().min(1),
      }),
    )
    .default([]),
  memoryEdges: z
    .array(
      z.object({
        targetId: z.string().min(1),
        type: z.enum(MEMORY_LLM_EDGE_TYPES),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});

export interface ExtractionNeighbour {
  id: string;
  content: string;
}

/**
 * One extraction, validated. Returns `null` when the model answered with
 * something the schema refuses — never a throw and never a repair, because a
 * guessed edge is worse than a missing one. A caller can tell the difference
 * between that and an unreachable model: this returns, that throws.
 */
export async function extractEnrichment(
  model: BaseChatModel,
  content: string,
  neighbours: ExtractionNeighbour[],
): Promise<Enrichment | null> {
  const structured = model.withStructuredOutput(extractionInputSchema, {
    name: "memory_extraction",
  });

  const raw = await structured.invoke([
    { role: "system", content: MEMORY_EXTRACTION_PROMPT },
    { role: "user", content: buildRequest(content, neighbours) },
  ]);

  return parseEnrichment(raw);
}

function buildRequest(
  content: string,
  neighbours: ExtractionNeighbour[],
): string {
  return [
    `Memory:\n${content}`,
    // The ids are the whole point: a memory edge is addressed by `targetId`,
    // and a model that was never shown one cannot emit anything but a guess.
    neighbours.length > 0
      ? `Other memories (refer to them by id):\n${neighbours
          .map((neighbour) => `- ${neighbour.id}: ${neighbour.content}`)
          .join("\n")}`
      : "No other memories.",
  ].join("\n\n");
}
