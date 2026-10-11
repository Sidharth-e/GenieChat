import { ModelConfig } from "../../types";
import { GOOGLE_MODELS } from "./google";
import { OLLAMA_MODELS } from "./ollama";
import { OPENROUTER_MODELS } from "./openrouter";

export { DEFAULT_MAX_INPUT_CHARS } from "./limits";
export { DEFAULT_MODEL_ID, GOOGLE_MODELS } from "./google";
export { OLLAMA_MODELS } from "./ollama";
export { JEV_ROUTER_MODEL_ID, OPENROUTER_MODELS } from "./openrouter";

/**
 * Every model the app offers, one provider's list after another.
 *
 * **The order is part of the contract, not a presentation choice.** Settings
 * falls back to `AVAILABLE_MODELS[0]` and the Arena seeds itself from
 * `.slice(0, MIN_ARENA_MODELS)`, so inserting a provider list ahead of google
 * changes what those two show. Append new models to the provider's own list
 * rather than reordering here.
 */
export const AVAILABLE_MODELS: ModelConfig[] = [
  ...GOOGLE_MODELS,
  ...OLLAMA_MODELS,
  ...OPENROUTER_MODELS,
];
