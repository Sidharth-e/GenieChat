import { ModelConfig, ReasoningEffort } from "../types";

const INPUT_LIMITS = {
  large: 120_000,
  standard: 100_000,
  compact: 80_000,
} as const;

export const DEFAULT_MAX_INPUT_CHARS = INPUT_LIMITS.standard;

/**
 * Fallback model used wherever a caller has no model of its own — new threads,
 * webhook runs, client-side display, workflow nodes. Must be an id present in
 * AVAILABLE_MODELS.
 */
export const DEFAULT_MODEL_ID = "gemini-3-flash-preview";

// Available models.
// Ollama model ids are the tag names pulled on the target server. When pointed
// at Ollama Cloud (the default), use the cloud library's tags — they are a
// different, smaller set than the local library, and large models carry an
// explicit size suffix (e.g. "deepseek-r1:671b").
export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "google",
    model: "gemini-3.5-flash",
    description: "Google's latest multimodal model",
    maxInputChars: INPUT_LIMITS.large,
    maxOutput: 65536,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
    supportReasoning: true,
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    model: "gemini-3-flash-preview",
    description: "Google's latest multimodal model",
    maxInputChars: INPUT_LIMITS.large,
    maxOutput: 65536,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
    supportReasoning: true,
  },
  {
    id: "gemini-3-pro-preview",
    name: "Gemini 3 Pro Preview",
    provider: "google",
    model: "gemini-3-pro-preview",
    description: "Google's most capable model",
    maxInputChars: INPUT_LIMITS.large,
    maxOutput: 65536,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
    supportReasoning: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    provider: "google",
    model: "gemini-3.1-pro-preview",
    description: "Google's latest reasoning model",
    maxInputChars: INPUT_LIMITS.large,
    maxOutput: 65536,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
    supportReasoning: true,
  },
  {
    id: "llama3.2",
    name: "Llama 3.2",
    provider: "ollama",
    model: "llama3.2",
    description: "Meta's lightweight general-purpose model",
    maxInputChars: INPUT_LIMITS.standard,
    maxOutput: 8192,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
  },
  {
    id: "gemma4",
    name: "Gemma 4",
    provider: "ollama",
    model: "gemma4",
    description: "Qwen's coding-focused model",
    maxInputChars: INPUT_LIMITS.standard,
    maxOutput: 8192,
    supportsStreaming: true,
    supportsTools: true,
    supportsTemperature: true,
    supportsTopP: true,
  },
  {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek v4.1 Flash",
    provider: "ollama",
    model: "deepseek-v4.1-flash:cloud",
    description: "DeepSeek's open reasoning model",
    maxInputChars: INPUT_LIMITS.standard,
    maxOutput: 16384,
    supportsStreaming: true,
    supportsTools: false,
    supportsTemperature: true,
    supportsTopP: true,
    supportReasoning: true,
  },
];

export interface ModelOptions {
  temperature?: number;
  topP?: number;
  streaming?: boolean;
  streamUsage?: boolean;
  reasoningEffort?: ReasoningEffort;
}

export const DEFAULT_OPTIONS: ModelOptions = {
  temperature: 0.7,
  topP: 1,
  streaming: true,
  streamUsage: true,
};

export function getModelMaxInputChars(modelId: string): number {
  return (
    AVAILABLE_MODELS.find((model) => model.id === modelId)?.maxInputChars ??
    DEFAULT_MAX_INPUT_CHARS
  );
}
