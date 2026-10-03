import { logger } from "@/lib/logger";
import { store } from "@/lib/store";
import { StreamPipeline } from "@/lib/api/stream-pipeline";
import { saveToolArtifact } from "@/lib/artifacts/save";
import { saveScancodeArtifacts } from "@/lib/artifacts/scancode";
import type { ArtifactPayload } from "@/lib/artifacts/types";
import { createTokenBuffer, SSE_HEADERS } from "./envelope";
import {
  fallbackUsage,
  parseToolResultEnvelope,
  type PersistedToolCall,
  type ProducerEvent,
  type TokenUsage,
} from "./events";
import type { ToolCallTracker } from "./tool-calls";

/** The slice of `StreamContext` the runner actually needs. */
export interface StreamRunContext {
  user: { id: string; name: string; email: string };
  requestBody: { message?: string; model: string };
  threadId: string;
  isNewThread: boolean;
  isFirstMessage: boolean;
  isRegeneration: boolean;
  regenerateMessageId?: string;
  pairedUserVersionId?: string;
  pairedAssistantVersionId?: string;
  savedUserMessageId?: string;
}

/** Everything a mode accumulates while its service streams. */
export interface StreamAccumulator {
  content: string;
  toolCalls: PersistedToolCall[];
  citations: string[];
  usage: TokenUsage;
}

/**
 * How the assistant message reaches the store.
 *
 * `final` (default) — one message at the end of the stream, reported to the
 * client as `message_saved`.
 * `external` — the mode persists inside its own `produce()`, because it saves
 * more than one message: swarm writes an assistant message per agent turn and
 * reports the id on each `agent_turn_end`, never on a `message_saved`.
 */
export type Persistence = "final" | "external";

/**
 * What to do with an `error` event yielded by `produce()`.
 *
 * `forward` (default) — write it and keep consuming, which is what agent,
 * multi-agent and swarm do.
 * `throw` — abandon the stream and let the catch block report it, which is what
 * chat does; the difference matters because it also skips persistence.
 * `swallow` — drop it, which is what swarm does today.
 */
export type ProducerErrorPolicy = "forward" | "throw" | "swallow";

/**
 * Persists the assistant message: a new version when regenerating, otherwise a
 * new message. Returns null when a versioned append found no target.
 */
export async function persistAssistantMessage(params: {
  context: StreamRunContext;
  payload: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const { context, payload } = params;
  const { threadId, user, isRegeneration, regenerateMessageId } = context;

  if (isRegeneration && regenerateMessageId) {
    return store.appendMessageVersion(
      threadId,
      regenerateMessageId,
      payload as Parameters<typeof store.appendMessageVersion>[2],
    );
  }

  // The adapter hands back a plain record, so the shape is re-asserted here
  // rather than threaded through as a nominal type.
  return store.addMessage(threadId, {
    threadId,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: "assistant",
    ...payload,
  } as Parameters<typeof store.addMessage>[1]);
}

/**
 * Drives one token-streaming mode end to end: envelope, accumulation,
 * persistence, title, done. Events the runner does not understand are written
 * to the wire verbatim, which is how each mode's vocabulary is preserved.
 *
 * `errorMessage` is per-mode on purpose — chat surfaces the real error, the
 * agent modes return a generic string. That difference is frozen.
 */
export async function runTokenStream(params: {
  context: StreamRunContext;
  produce: () => AsyncGenerator<ProducerEvent>;
  tracker: ToolCallTracker;
  /** Required unless `persistence` is `external`. */
  buildPayload?: (
    accumulator: StreamAccumulator,
    fallback: TokenUsage,
  ) => Record<string, unknown>;
  logPrefix: string;
  errorMessage?: string;
  persistence?: Persistence;
  producerError?: ProducerErrorPolicy;
  /**
   * Whether to emit an estimated `token_usage` when the provider reported none.
   * Swarm accounts usage per agent turn and never writes a stream total.
   */
  usageFallback?: boolean;
}): Promise<Response> {
  const {
    context,
    produce,
    tracker,
    buildPayload,
    logPrefix,
    errorMessage,
    persistence = "final",
    producerError = "forward",
    usageFallback = true,
  } = params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const writeEvent = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const accumulator: StreamAccumulator = {
        content: "",
        toolCalls: [],
        citations: [],
        usage: { prompt: 0, completion: 0, total: 0 },
      };

      const tokenBuffer = createTokenBuffer({
        onFlush: (buffered, meta) => {
          writeEvent({ type: "token", content: buffered, ...meta });
        },
      });

      const artifact = (raw: unknown) => {
        saveToolArtifact(context.user.id, raw as ArtifactPayload, context.threadId).catch(
          () => {},
        );
      };

      try {
        if (context.isNewThread) {
          writeEvent({ type: "thread", threadId: context.threadId });
        }
        if (context.savedUserMessageId) {
          writeEvent({
            type: "user_message_saved",
            messageId: context.savedUserMessageId,
          });
        }

        for await (const event of produce()) {
          if (event.type !== "token") tokenBuffer.flush();

          switch (event.type) {
            case "token":
              accumulator.content += event.content;
              tokenBuffer.push(event.content, event.meta);
              break;

            case "tool_start": {
              const { id, record } = tracker.onStart(event);
              accumulator.toolCalls.push(record);
              writeEvent({
                type: "tool_start",
                toolCall: { id, name: event.name, arguments: event.args, ...event.meta },
                ...event.meta,
              });
              break;
            }

            case "tool_result": {
              const { id, record: synthesized } = tracker.onResult(event);

              // A result that matched no start still gets a call of its own, so
              // the client is never told about a result it has no call for.
              if (synthesized) accumulator.toolCalls.push(synthesized);

              const record = id
                ? accumulator.toolCalls.find((tc) => tc.id === id)
                : undefined;

              writeEvent({
                type: "tool_result",
                toolCallId: id,
                result: event.result,
                ...event.meta,
              });

              if (record) {
                record.result = event.result;
                const envelope = parseToolResultEnvelope(event.result);
                if (envelope.tokens) record.tokens = envelope.tokens;
                for (const raw of envelope.artifacts) artifact(raw);
              }
              break;
            }

            case "token_usage":
              accumulator.usage.prompt += event.promptTokens;
              accumulator.usage.completion += event.completionTokens;
              accumulator.usage.total += event.totalTokens;
              writeEvent({
                type: "token_usage",
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                totalTokens: event.totalTokens,
              });
              break;

            case "citations":
              accumulator.citations = event.citations;
              writeEvent({ type: "citations", citations: event.citations });
              break;

            case "error":
              if (producerError === "throw") throw new Error(event.error);
              if (producerError === "forward") {
                writeEvent({ type: "error", error: event.error });
              }
              break;

            case "passthrough":
              writeEvent(event.payload);
              break;
          }
        }
        tokenBuffer.flush();

        // Scan codes are saved from the message text, not from a tool result —
        // the fence *is* the artifact, so there is no envelope to read. Detached
        // like the tool-artifact write above: storage must not be able to fail a
        // reply the user has already received.
        saveScancodeArtifacts(
          context.user.id,
          accumulator.content,
          context.threadId,
        ).catch(() => {});

        const fallback = fallbackUsage(
          (context.requestBody.message ?? "").length,
          accumulator.content.length,
        );

        if (persistence === "final") {
          if (!buildPayload) {
            throw new Error(
              `runTokenStream: buildPayload is required when persistence is "final"`,
            );
          }

          if (usageFallback && accumulator.usage.total === 0) {
            writeEvent({
              type: "token_usage",
              promptTokens: fallback.prompt,
              completionTokens: fallback.completion,
              totalTokens: fallback.total,
            });
          }

          const saved = await persistAssistantMessage({
            context,
            payload: buildPayload(accumulator, fallback),
          });
          if (!saved) {
            throw new Error("Failed to persist regenerated message version");
          }

          writeEvent({ type: "message_saved", messageId: saved.id });
        }

        await StreamPipeline.generateTitleIfNeeded(
          context.threadId,
          context.isFirstMessage,
          encoder,
          controller,
        );

        writeEvent({ type: "done" });
        controller.close();
      } catch (error) {
        logger.error({ err: error }, `${logPrefix} streaming error`);
        writeEvent({
          type: "error",
          error:
            errorMessage ??
            (error instanceof Error ? error.message : "An error occurred"),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
