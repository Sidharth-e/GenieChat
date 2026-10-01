import { describe, it, expect } from "vitest";
import {
  fallbackUsage,
  parseToolResultEnvelope,
  buildAssistantPayload,
} from "@/lib/api/stream/events";

describe("fallbackUsage", () => {
  it("estimates four characters per token", () => {
    expect(fallbackUsage(40, 80)).toEqual({ prompt: 10, completion: 20, total: 30 });
  });

  it("never reports zero tokens for an empty message", () => {
    expect(fallbackUsage(0, 0)).toEqual({ prompt: 1, completion: 1, total: 2 });
  });

  it("rounds a partial token up", () => {
    expect(fallbackUsage(5, 5)).toEqual({ prompt: 2, completion: 2, total: 4 });
  });
});

describe("parseToolResultEnvelope", () => {
  it("returns an empty envelope for undefined", () => {
    expect(parseToolResultEnvelope(undefined)).toEqual({ artifacts: [] });
  });

  it("returns an empty envelope for a non-JSON result", () => {
    expect(parseToolResultEnvelope("plain text")).toEqual({ artifacts: [] });
  });

  it("returns an empty envelope for JSON that is not an object", () => {
    expect(parseToolResultEnvelope("42")).toEqual({ artifacts: [] });
    expect(parseToolResultEnvelope("null")).toEqual({ artifacts: [] });
  });

  it("extracts _tokens", () => {
    const result = parseToolResultEnvelope('{"_tokens":{"prompt":3,"completion":4}}');
    expect(result.tokens).toEqual({ prompt: 3, completion: 4 });
  });

  it("collects a single _artifact and an _artifacts array", () => {
    const result = parseToolResultEnvelope(
      '{"_artifact":{"a":1},"_artifacts":[{"b":2},{"c":3}]}',
    );
    expect(result.artifacts).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("ignores an _artifacts value that is not an array", () => {
    expect(parseToolResultEnvelope('{"_artifacts":"nope"}').artifacts).toEqual([]);
  });

  it("returns an empty envelope for JSON with no envelope keys", () => {
    expect(parseToolResultEnvelope('{"value":1}')).toEqual({ artifacts: [] });
  });
});

describe("buildAssistantPayload", () => {
  const usage = { prompt: 0, completion: 0, total: 0 };
  const fallback = { prompt: 1, completion: 1, total: 2 };

  it("prefers real usage when the total is non-zero", () => {
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage: { prompt: 5, completion: 6, total: 11 },
      fallback,
      toolCalls: [],
      citations: [],
    });
    expect(payload.tokens).toEqual({ prompt: 5, completion: 6 });
  });

  it("falls back when the total is zero", () => {
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage,
      fallback,
      toolCalls: [],
      citations: [],
    });
    expect(payload.tokens).toEqual({ prompt: 1, completion: 1 });
  });

  it("omits toolCalls and citations when they are empty", () => {
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage,
      fallback,
      toolCalls: [],
      citations: [],
    });
    expect(payload.toolCalls).toBeUndefined();
    expect(payload.citations).toBeUndefined();
  });

  it("includes toolCalls and citations when they are non-empty", () => {
    const toolCalls = [{ id: "t1", name: "search", arguments: {} }];
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage,
      fallback,
      toolCalls,
      citations: ["doc-1"],
    });
    expect(payload.toolCalls).toEqual(toolCalls);
    expect(payload.citations).toEqual(["doc-1"]);
  });

  it("carries routedModel and arenaMetadata when supplied", () => {
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage,
      fallback,
      toolCalls: [],
      citations: [],
      routedModel: "m-fast",
      arenaMetadata: { isArena: true },
    });
    expect(payload.routedModel).toBe("m-fast");
    expect(payload.arenaMetadata).toEqual({ isArena: true });
  });

  it("carries versionId and pairedUserVersionId", () => {
    const payload = buildAssistantPayload({
      content: "hi",
      model: "m",
      usage,
      fallback,
      toolCalls: [],
      citations: [],
      versionId: "v1",
      pairedUserVersionId: "u1",
    });
    expect(payload.versionId).toBe("v1");
    expect(payload.pairedUserVersionId).toBe("u1");
  });
});
