import { describe, expect, it } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  extractEnrichment,
  extractionInputSchema,
} from "@/lib/memory/llm-extraction";

/**
 * A model is a network boundary, so it is faked here rather than called — but
 * only its transport. Everything under test is this module's own work: what the
 * prompt tells the model, and what happens to a response that is not the shape
 * the schema promised.
 */
function fakeModel(response: unknown) {
  const prompts: string[] = [];
  const model = {
    withStructuredOutput: () => ({
      invoke: async (messages: { content: unknown }[]) => {
        prompts.push(
          messages
            .map((message) =>
              typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content),
            )
            .join("\n"),
        );
        return response;
      },
    }),
  };
  return { model: model as unknown as BaseChatModel, prompts };
}

const valid = {
  entities: [{ name: "Acme", type: "organization" }],
  relations: [],
  memoryEdges: [],
};

describe("extractionInputSchema", () => {
  it("defaults the optional collections when the model omits them", () => {
    const parsed = extractionInputSchema.parse({
      entities: [{ name: "Acme", type: "organization" }],
    });
    expect(parsed.relations).toEqual([]);
    expect(parsed.memoryEdges).toEqual([]);
  });

  it("rejects an edge type outside the allow-list", () => {
    // Enforced at the schema as well as in parseEnrichment: the schema is what
    // the provider's structured-output layer validates against, so a model
    // cannot even return one.
    const result = extractionInputSchema.safeParse({
      ...valid,
      memoryEdges: [{ targetId: "m2", type: "ABOUT", reason: "not permitted" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entity with no name", () => {
    const result = extractionInputSchema.safeParse({
      entities: [{ name: "", type: "organization" }],
      relations: [],
      memoryEdges: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("extractEnrichment", () => {
  it("returns the validated enrichment for a well-formed response", async () => {
    const { model } = fakeModel(valid);
    const result = await extractEnrichment(model, "Acme is our vendor", []);
    expect(result?.entities[0].normalizedName).toBe("acme");
  });

  it("returns null rather than throwing on a malformed response", async () => {
    const { model } = fakeModel({ entities: "not an array" });
    await expect(extractEnrichment(model, "Acme", [])).resolves.toBeNull();
  });

  it("gives the model the neighbour ids it is asked to refer to", async () => {
    const { model, prompts } = fakeModel(valid);
    await extractEnrichment(model, "Acme is our vendor", [
      { id: "mem-42", content: "We left Acme in March" },
    ]);

    // The memory-edge type asks for a `targetId`. Without the ids in the prompt
    // there is nothing for the model to name, and SUPERSEDES/CONTRADICTS can
    // never be discovered.
    expect(prompts.join("\n")).toContain("mem-42");
    expect(prompts.join("\n")).toContain("We left Acme in March");
  });

  it("says so plainly when there are no neighbours", async () => {
    const { model, prompts } = fakeModel(valid);
    await extractEnrichment(model, "Acme is our vendor", []);
    expect(prompts.join("\n")).toContain("No other memories");
  });
});
