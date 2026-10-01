/** Metadata carried alongside a token so the client can attribute it. */
export interface TokenMeta {
  agentId?: string;
  agentName?: string;
  parentToolCallId?: string;
}

/** A tool call as persisted onto the assistant message. */
export interface PersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  tokens?: { prompt: number; completion: number };
  agentId?: string;
  agentName?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * The common vocabulary every mode adapter translates its own service events
 * into. The runner consumes the known kinds and forwards `passthrough`
 * verbatim, which is how each mode's event vocabulary survives the refactor.
 */
export type ProducerEvent =
  | { type: "token"; content: string; meta?: TokenMeta }
  | {
      type: "tool_start";
      sourceId?: string;
      name: string;
      args: Record<string, unknown>;
      meta?: TokenMeta;
    }
  | {
      type: "tool_result";
      sourceId?: string;
      name?: string;
      result: string;
      meta?: TokenMeta;
    }
  | {
      type: "token_usage";
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: "citations"; citations: string[] }
  | { type: "error"; error: string }
  | { type: "passthrough"; payload: Record<string, unknown> };

/**
 * Rough token estimate used when the provider reports no usage. The
 * `Math.max(1, ...)` floor is load-bearing: a zero-length prompt must never
 * record zero tokens.
 */
export function fallbackUsage(
  messageLength: number,
  responseLength: number,
): TokenUsage {
  const prompt = Math.max(1, Math.ceil(messageLength / 4));
  const completion = Math.max(1, Math.ceil(responseLength / 4));
  return { prompt, completion, total: prompt + completion };
}

export interface ToolResultEnvelope {
  tokens?: { prompt: number; completion: number };
  artifacts: unknown[];
}

/**
 * Reads the `_tokens` / `_artifact` / `_artifacts` envelope several tools wrap
 * their result in. Never throws — a non-JSON result or JSON without the
 * envelope keys yields an empty envelope.
 */
export function parseToolResultEnvelope(
  result: string | undefined,
): ToolResultEnvelope {
  const empty: ToolResultEnvelope = { artifacts: [] };
  if (!result) return empty;

  try {
    const parsed: unknown = JSON.parse(result);
    if (parsed === null || typeof parsed !== "object") return empty;

    const record = parsed as Record<string, unknown>;
    const artifacts: unknown[] = [];
    if (record._artifact) artifacts.push(record._artifact);
    if (Array.isArray(record._artifacts)) artifacts.push(...record._artifacts);

    const rawTokens = record._tokens as
      | { prompt?: unknown; completion?: unknown }
      | undefined;
    const tokens =
      rawTokens && typeof rawTokens === "object"
        ? {
            prompt: Number(rawTokens.prompt ?? 0),
            completion: Number(rawTokens.completion ?? 0),
          }
        : undefined;

    return { tokens, artifacts };
  } catch {
    return empty;
  }
}

export interface BuildAssistantPayloadArgs {
  content: string;
  model: string;
  usage: TokenUsage;
  fallback: TokenUsage;
  toolCalls: PersistedToolCall[];
  citations: string[];
  versionId?: string;
  routedModel?: string;
  pairedUserVersionId?: string;
  arenaMetadata?: unknown;
  /**
   * What to do when the provider reported no usage at all. `"fallback"`
   * (default) estimates it, so a token-mode client never sees a zero. `"omit"`
   * leaves the field off the document entirely — arena persists per-model
   * totals and has no single stream to estimate from.
   */
  zeroUsagePolicy?: "fallback" | "omit";
}

/**
 * Shapes the persisted assistant message. Mode adapters differ only in the
 * extra fields they supply — chat adds `routedModel`, arena adds
 * `arenaMetadata` — so the common shape lives here.
 */
export function buildAssistantPayload(
  args: BuildAssistantPayloadArgs,
): Record<string, unknown> {
  return {
    versionId: args.versionId,
    content: args.content,
    model: args.model,
    routedModel: args.routedModel,
    toolCalls: args.toolCalls.length > 0 ? args.toolCalls : undefined,
    tokens:
      args.usage.total > 0
        ? { prompt: args.usage.prompt, completion: args.usage.completion }
        : args.zeroUsagePolicy === "omit"
          ? undefined
          : {
              prompt: args.fallback.prompt,
              completion: args.fallback.completion,
            },
    citations: args.citations.length > 0 ? args.citations : undefined,
    arenaMetadata: args.arenaMetadata,
    pairedUserVersionId: args.pairedUserVersionId,
  };
}
