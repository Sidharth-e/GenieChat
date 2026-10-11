import { describe, it, expect } from "vitest";
import {
  getModelMaxInputChars,
  AVAILABLE_MODELS,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_MODEL_ID,
  JEV_ROUTER_MODEL_ID,
  formatModelName,
  isAutoRouterModel,
  resolveAutoRoute,
  type RoutedMessage,
} from "@/lib/langchain/model-config";
import {
  GOOGLE_MODELS,
  OLLAMA_MODELS,
  OPENROUTER_MODELS,
} from "@/lib/langchain/models";

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

describe("AVAILABLE_MODELS assembly", () => {
  it("is the per-provider lists concatenated, in provider order", () => {
    // Settings falls back to `AVAILABLE_MODELS[0]` and the Arena seeds itself from
    // `.slice(0, MIN_ARENA_MODELS)`, so the assembled order is contract rather than
    // an accident of how the lists happened to be spread into one array.
    expect(AVAILABLE_MODELS).toEqual([
      ...GOOGLE_MODELS,
      ...OLLAMA_MODELS,
      ...OPENROUTER_MODELS,
    ]);
  });

  it("keeps every model under the provider its own module declares", () => {
    for (const model of GOOGLE_MODELS) {
      expect(model.provider, `${model.id} is filed under google`).toBe("google");
    }
    for (const model of OLLAMA_MODELS) {
      expect(model.provider, `${model.id} is filed under ollama`).toBe("ollama");
    }
    for (const model of OPENROUTER_MODELS) {
      expect(model.provider, `${model.id} is filed under openrouter`).toBe("openrouter");
    }
  });

  it("routes through the router entry the openrouter list itself carries", () => {
    // The id and the entry it names have to move together: the router is only a
    // router because `isAutoRouterModel` sees the id in the list it is drawn from.
    const router = OPENROUTER_MODELS.find((m) => m.id === JEV_ROUTER_MODEL_ID);
    expect(router).toBeDefined();
    expect(router?.model).toBe("typesafe/jev-router");
  });
});

describe("formatModelName", () => {
  it("formats known model IDs from AVAILABLE_MODELS", () => {
    expect(formatModelName(JEV_ROUTER_MODEL_ID)).toBe("Jev Router (Auto)");
    expect(formatModelName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
  });

  it("formats unknown or downstream model paths gracefully", () => {
    expect(formatModelName("anthropic/claude-3.5-sonnet")).toBe("Claude 3.5 Sonnet");
    expect(formatModelName("openai/gpt-4o")).toBe("Gpt 4o");
    expect(formatModelName("")).toBe("");
    expect(formatModelName(undefined)).toBe("");
  });
});

describe("isAutoRouterModel", () => {
  it("is true only for the Jev Router id", () => {
    expect(isAutoRouterModel(JEV_ROUTER_MODEL_ID)).toBe(true);
    expect(isAutoRouterModel("deepseek-v4.1-flash")).toBe(false);
    expect(isAutoRouterModel("openrouter/claude-sonnet-5")).toBe(false);
    expect(isAutoRouterModel(null)).toBe(false);
    expect(isAutoRouterModel(undefined)).toBe(false);
  });
});

describe("resolveAutoRoute", () => {
  const message = (over: Partial<RoutedMessage> = {}): RoutedMessage => ({
    role: "assistant",
    ...over,
  });

  it("is not auto when a plain model is selected, even though the provider reported a served model", () => {
    // `routedModel` is set on every completion (the provider names itself in
    // response_metadata), so a truthy value must never be read as "the router ran".
    const state = resolveAutoRoute({
      activeModelId: "deepseek-v4.1-flash",
      liveRoutedModel: "deepseek-v4.1-flash:cloud",
      messages: [
        message({ model: "deepseek-v4.1-flash", routedModel: "deepseek-v4.1-flash:cloud" }),
      ],
    });

    expect(state.isAuto).toBe(false);
    expect(state.routedModel).toBeNull();
  });

  it("ignores routedModel recorded against a message that did not run through the router", () => {
    const state = resolveAutoRoute({
      activeModelId: JEV_ROUTER_MODEL_ID,
      liveRoutedModel: null,
      messages: [
        message({ model: "glm-5.3-flash", routedModel: "glm-5.3-flash:cloud" }),
        message({ model: JEV_ROUTER_MODEL_ID, routedModel: "openai/gpt-6-luna" }),
      ],
    });

    expect(state.isAuto).toBe(true);
    expect(state.routedModel).toBe("openai/gpt-6-luna");
  });

  it("takes the newest routed message in the thread", () => {
    const state = resolveAutoRoute({
      activeModelId: JEV_ROUTER_MODEL_ID,
      liveRoutedModel: null,
      messages: [
        message({ model: JEV_ROUTER_MODEL_ID, routedModel: "openai/gpt-6-luna" }),
        message({ role: "user" }),
        message({ model: JEV_ROUTER_MODEL_ID, routedModel: "deepseek/deepseek-v4.1-flash" }),
      ],
    });

    expect(state.routedModel).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("prefers the live route over history while a stream is in flight", () => {
    const state = resolveAutoRoute({
      activeModelId: JEV_ROUTER_MODEL_ID,
      liveRoutedModel: "openai/gpt-6-luna",
      messages: [message({ model: JEV_ROUTER_MODEL_ID, routedModel: "deepseek/deepseek-v4.1-flash" })],
    });

    expect(state.routedModel).toBe("openai/gpt-6-luna");
  });

  it("reports auto with no target before the router has chosen anything", () => {
    expect(
      resolveAutoRoute({
        activeModelId: JEV_ROUTER_MODEL_ID,
        liveRoutedModel: null,
        messages: [],
      }),
    ).toEqual({ isAuto: true, routedModel: null });
  });

  it("is not auto when no model is selected", () => {
    expect(
      resolveAutoRoute({ activeModelId: undefined, liveRoutedModel: null, messages: [] }),
    ).toEqual({ isAuto: false, routedModel: null });
  });
});
