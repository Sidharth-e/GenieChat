import { describe, expect, it } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  extractFacts,
  factExtractionInputSchema,
  parseFactExtraction,
} from "@/lib/memory/llm-facts";

/**
 * Only the transport is faked. Everything under test is this module's own
 * work: what the prompt asks for, and what happens to an answer that is not
 * the shape it promised.
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

const triple = {
  subject: "user",
  predicate: "works as",
  object: "Rust developer",
  objectKind: "entity",
  operation: "add",
  confidence: 0.9,
};

describe("factExtractionInputSchema", () => {
  it("defaults operation to add — the system never silently drops a fact", () => {
    const parsed = factExtractionInputSchema.parse({
      facts: [{ ...triple, operation: undefined }],
    });
    expect(parsed.facts[0].operation).toBe("add");
  });

  it("refuses an operation outside add|replace", () => {
    const result = factExtractionInputSchema.safeParse({
      facts: [{ ...triple, operation: "delete" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an objectKind outside entity|value", () => {
    const result = factExtractionInputSchema.safeParse({
      facts: [{ ...triple, objectKind: "person" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty fact list", () => {
    expect(factExtractionInputSchema.parse({ facts: [] }).facts).toEqual([]);
  });
});

describe("parseFactExtraction", () => {
  const text = "I work as a Rust developer in Bangalore";

  it("returns null rather than throwing on a malformed response", () => {
    expect(parseFactExtraction({ facts: "not an array" }, text)).toBeNull();
  });

  it("normalizes the predicate to its canonical name", () => {
    const facts = parseFactExtraction({ facts: [triple] }, text);
    expect(facts?.[0].predicate).toBe("WORKS_AS");
  });

  it("keeps the literal subject `user`, which is not a word in the sentence", () => {
    // The prompt tells the model to use "user" for the person themself, so the
    // containment guard has to exempt it — otherwise every personal fact is
    // dropped, and personal facts are the whole corpus.
    const facts = parseFactExtraction({ facts: [triple] }, text);
    expect(facts).toHaveLength(1);
  });

  it("drops a triple whose subject is not in the sentence", () => {
    // The hallucination guard: a model that invents an entity must not be able
    // to write a fact about someone the user never mentioned.
    const facts = parseFactExtraction(
      { facts: [{ ...triple, subject: "Google" }] },
      text,
    );
    expect(facts).toEqual([]);
  });

  it("drops a triple whose object is not in the sentence", () => {
    const facts = parseFactExtraction(
      { facts: [{ ...triple, object: "Swift developer" }] },
      text,
    );
    expect(facts).toEqual([]);
  });

  it("does not exempt `user` as an object", () => {
    const facts = parseFactExtraction(
      { facts: [{ ...triple, object: "user" }] },
      text,
    );
    expect(facts).toEqual([]);
  });

  it("matches the sentence case-insensitively", () => {
    const facts = parseFactExtraction(
      { facts: [{ ...triple, object: "bangalore" }] },
      text,
    );
    expect(facts).toHaveLength(1);
  });

  it("drops a triple whose predicate normalizes to nothing", () => {
    const facts = parseFactExtraction(
      { facts: [{ ...triple, predicate: "?!" }] },
      text,
    );
    expect(facts).toEqual([]);
  });

  it("keeps the facts it can and drops only the ones it cannot, in order", () => {
    const facts = parseFactExtraction(
      {
        facts: [
          triple,
          { ...triple, object: "Swift developer" },
          { ...triple, predicate: "lives in", object: "Bangalore" },
        ],
      },
      text,
    );
    expect(facts?.map((f) => f.predicate)).toEqual(["WORKS_AS", "LIVES_IN"]);
  });

  it("carries objectKind, operation and confidence through", () => {
    const facts = parseFactExtraction(
      {
        facts: [
          {
            subject: "user",
            predicate: "prefers",
            object: "short answers",
            objectKind: "value",
            operation: "replace",
            confidence: 0.4,
          },
        ],
      },
      "I prefer short answers",
    );
    expect(facts?.[0]).toMatchObject({
      objectKind: "value",
      operation: "replace",
      confidence: 0.4,
    });
  });
});

describe("extractFacts", () => {
  it("returns the parsed facts for a well-formed response", async () => {
    const { model } = fakeModel({ facts: [triple] });
    const facts = await extractFacts(model, "I work as a Rust developer", []);
    expect(facts?.[0].predicate).toBe("WORKS_AS");
  });

  it("shows the model the canonical predicates already in use", async () => {
    const { model, prompts } = fakeModel({ facts: [] });
    await extractFacts(model, "I work as a Rust developer", ["WORKS_AS", "LIKES"]);
    expect(prompts.join("\n")).toContain("WORKS_AS");
  });

  it("says so plainly when the graph has no predicates yet", async () => {
    const { model, prompts } = fakeModel({ facts: [] });
    await extractFacts(model, "I work as a Rust developer", []);
    expect(prompts.join("\n")).toContain("No existing predicates");
  });

  it("propagates a transport failure rather than reporting no facts", async () => {
    // A dead model must not look like "this sentence asserted nothing".
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error("model unreachable");
        },
      }),
    } as unknown as BaseChatModel;
    await expect(extractFacts(model, "anything", [])).rejects.toThrow(
      "model unreachable",
    );
  });
});
