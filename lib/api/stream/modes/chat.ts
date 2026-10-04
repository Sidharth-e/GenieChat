import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { chatService } from "@/lib/langchain/chat-service";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { createSaveMemoryTool } from "@/lib/tool/memory";
import { convertCustomToolsToLangChain } from "@/lib/tool/custom-tool-converter";
import { loadUserTooling, filterConnectors, type UserTooling } from "../context";
import { handleError, api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { StreamPipeline, type StreamContext } from "@/lib/api/stream-pipeline";
import { buildAssistantPayload, type ProducerEvent } from "../events";
import {
  runTokenStream,
  type StreamAccumulator,
  type StreamRunContext,
} from "../runner";
import { createChatTracker } from "../tool-calls";

type ChatCustomTools = ReturnType<typeof convertCustomToolsToLangChain>;

/**
 * The chat mode's own setup, then the service call mapped onto the shared
 * vocabulary.
 *
 * `routedModel` reaches the client as a `passthrough` — the runner has no
 * opinion about it — but it also has to reach the persisted assistant message,
 * so the generator writes it into this closure and `buildPayload` reads it back
 * after iteration finishes.
 */
export function createChatMode(params: {
  context: StreamContext;
  timezone: string;
}) {
  const { context, timezone } = params;
  const { user, requestBody } = context;
  const { model, forceWebSearch, message, reasoningEffort } = requestBody;
  const memoryEnabled = requestBody.memoryEnabled ?? true;
  const userId = user.id;

  let routedModel: string | undefined;

  // Kick off memory retrieval immediately so it runs in parallel with tool
  // loading, exactly as it did inline.
  const memoryPromise: Promise<string[]> = memoryEnabled
    ? (async () => {
        try {
          const memoryStore = new MemoryGraphStore();
          const retrievalResult =
            await memoryStore.searchRelevantMemoriesWithGraph(
              userId,
              message,
              5,
            );
          const strings = retrievalResult.memories.map((m) => `- ${m.content}`);
          if (strings.length > 0) {
            logger.info(
              `[API] Retrieved ${strings.length} memory item(s) via ${retrievalResult.metadata.mode} (semanticSeeds=${retrievalResult.metadata.semanticSeedCount}, lexicalSeeds=${retrievalResult.metadata.lexicalSeedCount}, graphExpanded=${retrievalResult.metadata.graphExpandedCount})`,
            );
          }
          return strings;
        } catch (err) {
          logger.error({ err }, "Failed to load user memories");
          return [];
        }
      })()
    : Promise.resolve([]);

  const customToolsForAI: ChatCustomTools = [];

  if (memoryEnabled) {
    customToolsForAI.push(createSaveMemoryTool(userId, user.name, user.email));
  }

  // Started here for the same reason as the retrieval above — the two database
  // rounds overlap instead of queueing. Chat binds every enabled connector and
  // every enabled custom tool, because unlike the agent surfaces it has no
  // record naming the subset it may use.
  const toolingPromise: Promise<UserTooling> = loadUserTooling({
    userId,
    customToolSelection: "all-enabled",
  });

  async function* produce(): AsyncGenerator<ProducerEvent> {
    logger.info(
      "Messages for processing:",
      context.messages.length,
      context.messages.map((m) => ({
        role: m.role,
        contentLength: m.content?.length,
      })),
    );

    // Await the retrieval that was started in parallel with tool loading.
    const memoryStrings = memoryEnabled
      ? await memoryPromise
      : (logger.info("[API] Memory disabled for this request"), []);

    const tooling = await toolingPromise;
    const connectors = filterConnectors({
      allServers: tooling.allServers,
      secretMap: tooling.secretMap,
      includeAllEnabled: true,
    });

    // The memory tools are constructed here rather than loaded, so they are not
    // part of `tooling.customTools` — a user tool reusing one of their names
    // would otherwise bind twice.
    const memoryToolNames = new Set(customToolsForAI.map((t) => t.name));
    const customTools = [
      ...customToolsForAI,
      ...tooling.customTools.filter((t) => !memoryToolNames.has(t.name)),
    ];

    for await (const event of await chatService.streamChat({
      messages: context.messages,
      modelId: model,
      reasoningEffort,
      images: context.imagesForAI,
      customTools,
      connectors,
      forceWebSearch,
      userContext: {
        userId,
        name: user.name,
        email: user.email,
        timezone,
        memories: memoryStrings,
        threadId: context.threadId,
      },
    })) {
      switch (event.type) {
        case "token":
          yield { type: "token", content: event.content };
          break;

        case "tool_start":
          yield {
            type: "tool_start",
            sourceId: event.toolCall.id,
            name: event.toolCall.name,
            args: event.toolCall.arguments,
          };
          break;

        case "tool_result":
          yield {
            type: "tool_result",
            sourceId: event.toolCallId,
            result: event.result,
          };
          break;

        case "token_usage":
          yield {
            type: "token_usage",
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            totalTokens: event.totalTokens,
          };
          break;

        case "citations":
          yield { type: "citations", citations: event.citations };
          break;

        case "model_resolved":
          routedModel = event.routedModel;
          yield {
            type: "passthrough",
            payload: { type: "model_resolved", routedModel: event.routedModel },
          };
          break;
      }
    }
  }

  function buildPayload(
    accumulator: StreamAccumulator,
    fallback: { prompt: number; completion: number; total: number },
  ): Record<string, unknown> {
    return buildAssistantPayload({
      versionId: context.pairedAssistantVersionId,
      content: accumulator.content,
      model,
      routedModel,
      toolCalls: accumulator.toolCalls,
      citations: accumulator.citations,
      usage: accumulator.usage,
      fallback,
      pairedUserVersionId: context.pairedUserVersionId,
    });
  }

  return { produce, buildPayload };
}

/**
 * The chat stream's entry point: rate limit under the chat namespace, prepare
 * the shared context, then hand the whole run to the runner.
 *
 * `errorMessage` is deliberately omitted so the real error reaches the client —
 * chat is the one mode that surfaces it.
 */
export async function handleChatStream(req: NextRequest): Promise<Response> {
  try {
    const rateLimit = await checkRateLimit(req, {
      namespace: "chat_stream",
      ...config.rateLimit.streaming,
    });

    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        "Rate limit exceeded. Please try again later.",
        rateLimit.retryAfterSeconds,
      );
    }

    const context = await StreamPipeline.prepareStreamContext(req);
    const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";
    const mode = createChatMode({ context, timezone });

    const runContext: StreamRunContext = context;

    return runTokenStream({
      context: runContext,
      produce: mode.produce,
      tracker: createChatTracker(),
      buildPayload: mode.buildPayload,
      logPrefix: "[ChatStream]",
      producerError: "throw",
    });
  } catch (error) {
    logger.error({ err: error }, "Chat stream error");
    return handleError(error, "Chat stream");
  }
}
