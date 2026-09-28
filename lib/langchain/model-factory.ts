/**
 * Model Factory
 *
 * Centralized utility for creating LangChain model instances.
 * This avoids code duplication across chat-service, agent-service,
 * multi-agent-service, and workflow-execution-service.
 */

import "server-only";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenRouter } from "@langchain/openrouter";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_OPTIONS,
  ModelOptions,
} from "./model-config";
import { ModelConfig, ProviderKey, ReasoningEffort } from "../types";
import { config as appConfig } from "@/lib/config";

export { AVAILABLE_MODELS, DEFAULT_OPTIONS };
export type { ModelOptions };

/**
 * Get a LangChain chat model based on the model ID.
 *
 * @param modelId - The model ID from AVAILABLE_MODELS
 * @param options - Optional configuration overrides
 * @returns A configured BaseChatModel instance
 * @throws Error if the model ID or provider is not supported
 */
export function getModel(
  modelId: string,
  options: ModelOptions = {},
): BaseChatModel {
  const resolvedModelId = resolveModelId(modelId);
  const modelConfig = AVAILABLE_MODELS.find(
    (m) => m.id === resolvedModelId || m.model === resolvedModelId,
  );
  if (!modelConfig) {
    throw new Error(`Unknown model: ${resolvedModelId}`);
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const temperatureOption = modelConfig.supportsTemperature
    ? { temperature: opts.temperature }
    : {};
  const topPOption = modelConfig.supportsTopP ? { topP: opts.topP } : {};

  switch (modelConfig.provider) {
    case "google": {
      const googleThinking = getGoogleThinkingConfig(
        opts.reasoningEffort,
        modelConfig,
      );
      return new ChatGoogleGenerativeAI({
        model: modelConfig.model,
        streaming: opts.streaming,
        ...temperatureOption,
        ...topPOption,
        maxOutputTokens: modelConfig.maxOutput,
        apiKey: appConfig.google.apiKey,
        ...(googleThinking ? { thinkingConfig: googleThinking } : {}),
      }) as BaseChatModel;
    }
    case "ollama":
      return new ChatOllama({
        model: modelConfig.model,
        baseUrl: appConfig.ollama.baseUrl,
        headers: getOllamaHeaders(),
        streaming: opts.streaming,
        ...temperatureOption,
        ...topPOption,
        numPredict: modelConfig.maxOutput,
      }) as BaseChatModel;
    case "openrouter": {
      const openRouterModel = new ChatOpenRouter({
        model: modelConfig.model,
        apiKey: appConfig.openrouter.apiKey,
        ...temperatureOption,
        ...topPOption,
        maxTokens: modelConfig.maxOutput,
      });

      const origCall = openRouterModel.caller.callWithOptions.bind(openRouterModel.caller);
      openRouterModel.caller.callWithOptions = (async (
        ...args: Parameters<typeof origCall>
      ) => {
        const result = await origCall(...args);
        if (!(result instanceof Response) || !result.body) {
          return result;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        const transform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            const match = buffer.match(/"model"\s*:\s*"([^"]+)"/);
            if (match && match[1]) {
              (openRouterModel as unknown as { lastRoutedModel: string }).lastRoutedModel = match[1];
            }
            controller.enqueue(chunk);
          },
        });

        const pipedBody = result.body.pipeThrough(transform);
        return new Response(pipedBody, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        });
      }) as typeof openRouterModel.caller.callWithOptions;

      return openRouterModel as BaseChatModel;
    }
    default:
      throw new Error(`Unsupported provider: ${modelConfig.provider}`);
  }
}

function getGoogleThinkingConfig(
  effort: ReasoningEffort | undefined,
  modelConfig: ModelConfig,
) {
  if (!effort || effort === "off" || !modelConfig.supportReasoning)
    return undefined;
  const levelMap = { low: "LOW", medium: "MEDIUM", high: "HIGH" } as const;
  return { thinkingLevel: levelMap[effort] as "LOW" | "MEDIUM" | "HIGH" };
}

/**
 * Ollama Cloud authenticates with a bearer token rather than an SDK option,
 * so the key travels as a header. Locally-hosted Ollama needs no auth.
 */
function getOllamaHeaders(): Record<string, string> | undefined {
  const apiKey = appConfig.ollama.apiKey;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
}

function isLocalOllamaUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function isProviderConfigured(provider: ProviderKey): boolean {
  switch (provider) {
    case "google":
      return Boolean(appConfig.google.apiKey);
    case "ollama":
      return Boolean(
        appConfig.ollama.baseUrl &&
          (appConfig.ollama.apiKey ||
            isLocalOllamaUrl(appConfig.ollama.baseUrl)),
      );
    case "openrouter":
      return Boolean(appConfig.openrouter.apiKey);
    default:
      return false;
  }
}

export function getConfiguredModels(): ModelConfig[] {
  return AVAILABLE_MODELS.filter((model) =>
    isProviderConfigured(model.provider),
  );
}

export function resolveModelId(modelId: string): string {
  const requestedModel = AVAILABLE_MODELS.find(
    (model) => model.id === modelId || model.model === modelId,
  );
  if (!requestedModel) {
    return modelId;
  }

  if (isProviderConfigured(requestedModel.provider)) {
    return requestedModel.id;
  }

  const fallbackModel = getConfiguredModels()[0];
  if (!fallbackModel) {
    throw new Error(
      `Model provider "${requestedModel.provider}" is not configured and no fallback model is available.`,
    );
  }

  return fallbackModel.id;
}

/**
 * Get the default model (Gemini Flash) for fallback scenarios.
 *
 * @param options - Optional configuration overrides
 * @returns A configured ChatGoogleGenerativeAI instance
 */
export function getDefaultModel(options: ModelOptions = {}): BaseChatModel {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const defaultModelConfig = AVAILABLE_MODELS.find(
    (m) => m.id === DEFAULT_MODEL_ID,
  );
  const temperatureOption = defaultModelConfig?.supportsTemperature
    ? { temperature: opts.temperature }
    : {};
  const topPOption = defaultModelConfig?.supportsTopP
    ? { topP: opts.topP }
    : {};

  return new ChatGoogleGenerativeAI({
    model: DEFAULT_MODEL_ID,
    streaming: opts.streaming,
    ...temperatureOption,
    ...topPOption,
    maxOutputTokens: defaultModelConfig?.maxOutput ?? 65536,
    apiKey: appConfig.google.apiKey,
  }) as BaseChatModel;
}
