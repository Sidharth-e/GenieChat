import { describe, it, expect } from "vitest";
import {
  getModelMaxInputChars,
  AVAILABLE_MODELS,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_MODEL_ID,
  JEV_ROUTER_MODEL_ID,
} from "@/lib/langchain/model-config";

describe("getModelMaxInputChars", () => {
  it("returns the standard limit for llama3.2 (100_000)", () => {
    expect(getModelMaxInputChars("llama3.2")).toBe(100_000);
  });

  it("returns the large limit for gemini-3-flash-preview (120_000)", () => {
    expect(getModelMaxInputChars("gemini-3-flash-preview")).toBe(120_000);
  });

  it("returns the standard limit for qwen2.5-coder (100_000)", () => {
    expect(getModelMaxInputChars("qwen2.5-coder")).toBe(100_000);
  });

  it("returns DEFAULT_MAX_INPUT_CHARS for an unknown model ID", () => {
    expect(getModelMaxInputChars("totally-unknown-model")).toBe(DEFAULT_MAX_INPUT_CHARS);
  });

  it("DEFAULT_MAX_INPUT_CHARS is 100_000", () => {
    expect(DEFAULT_MAX_INPUT_CHARS).toBe(100_000);
  });
});

describe("DEFAULT_MODEL_ID", () => {
  it("names a model that actually exists in AVAILABLE_MODELS", () => {
    expect(AVAILABLE_MODELS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true);
  });
});

describe("AVAILABLE_MODELS", () => {
  it("is non-empty", () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
  });

  it("only references providers that still exist", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.provider, `unexpected provider for ${model.id}`).toMatch(
        /^(google|ollama|openrouter)$/,
      );
    }
  });

  it("every model has a non-empty id", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.id, `id missing for model: ${JSON.stringify(model)}`).toBeTruthy();
    }
  });

  it("every model has a non-empty provider", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.provider, `provider missing for ${model.id}`).toBeTruthy();
    }
  });

  it("every model has a non-empty model string", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.model, `model string missing for ${model.id}`).toBeTruthy();
    }
  });

  it("every model has a positive maxInputChars", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.maxInputChars, `maxInputChars invalid for ${model.id}`).toBeGreaterThan(0);
    }
  });

  it("every model has a positive maxOutput", () => {
    for (const model of AVAILABLE_MODELS) {
      expect(model.maxOutput, `maxOutput invalid for ${model.id}`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate model IDs", () => {
    const ids = AVAILABLE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes openrouter models", () => {
    const openrouterModels = AVAILABLE_MODELS.filter((m) => m.provider === "openrouter");
    expect(openrouterModels.length).toBeGreaterThan(0);
    expect(openrouterModels.some((m) => m.id === "openrouter/claude-sonnet-5")).toBe(true);
    expect(openrouterModels.some((m) => m.id === JEV_ROUTER_MODEL_ID)).toBe(true);
    const jev = openrouterModels.find((m) => m.id === JEV_ROUTER_MODEL_ID);
    expect(jev?.model).toBe("typesafe/jev-router");
    expect(jev?.supportsStreaming).toBe(true);
  });
});
