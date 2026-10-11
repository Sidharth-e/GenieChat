import { ReasoningEffort } from "../types";
import {
  AVAILABLE_MODELS,
  DEFAULT_MAX_INPUT_CHARS,
  JEV_ROUTER_MODEL_ID,
} from "./models";

export {
  AVAILABLE_MODELS,
  DEFAULT_MAX_INPUT_CHARS,
  DEFAULT_MODEL_ID,
  JEV_ROUTER_MODEL_ID,
} from "./models";

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
    AVAILABLE_MODELS.find(
      (model) => model.id === modelId || model.model === modelId,
    )?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS
  );
}

export function formatModelName(modelId?: string): string {
  if (!modelId) return "";
  const found = AVAILABLE_MODELS.find(
    (m) => m.id === modelId || m.model === modelId,
  );
  if (found) return found.name;

  const parts = modelId.split("/");
  const rawName = parts[parts.length - 1] || modelId;
  return rawName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The slice of a message that decides whether it ran through the router.
 * Every provider names the model it served in `response_metadata`, so the chat
 * service emits `model_resolved` — and this `routedModel` — on *every*
 * completion, not only the router's. Ask the requested `model` instead.
 */
export interface RoutedMessage {
  role: string;
  model?: string;
  routedModel?: string;
}

export function isAutoRouterModel(modelId: string | null | undefined): boolean {
  return modelId === JEV_ROUTER_MODEL_ID;
}

export interface AutoRouteState {
  /** True only when the model in effect for the next message is the router. */
  isAuto: boolean;
  /** Where the router sent the request — null outside auto mode. */
  routedModel: string | null;
}

/**
 * Resolves the auto-router badge for a conversation.
 *
 * `routedModel` is a record of the model the provider actually served, which
 * every provider reports, so it is only meaningful as a routing target on a
 * message whose requested model was the router. Reading it bare — as the
 * header, telemetry panel and message chip used to — makes "Auto" appear on
 * every conversation, including one where a single model was chosen.
 */
export function resolveAutoRoute(params: {
  activeModelId: string | null | undefined;
  liveRoutedModel: string | null;
  messages: readonly RoutedMessage[];
}): AutoRouteState {
  const isAuto = isAutoRouterModel(params.activeModelId);
  if (!isAuto) return { isAuto: false, routedModel: null };

  if (params.liveRoutedModel) {
    return { isAuto: true, routedModel: params.liveRoutedModel };
  }

  for (let i = params.messages.length - 1; i >= 0; i--) {
    const message = params.messages[i];
    if (
      message.role === "assistant" &&
      isAutoRouterModel(message.model) &&
      message.routedModel
    ) {
      return { isAuto: true, routedModel: message.routedModel };
    }
  }

  return { isAuto: true, routedModel: null };
}
