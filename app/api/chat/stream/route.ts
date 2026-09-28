import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { chatService } from "@/lib/langchain/chat-service";
import { store } from "@/lib/store";
import { convertCustomToolsToLangChain } from "@/lib/tool/custom-tool-converter";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import {
  createSaveMemoryTool,
  createEditMemoryTool,
  createDeleteMemoryTool,
} from "@/lib/tool/memory";
import { handleError, api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { StreamPipeline } from "@/lib/api/stream-pipeline";
import type { UserContext } from "@/lib/langchain/langchain-utility";
import { saveToolArtifact } from "@/lib/artifacts/save";

export const runtime = "nodejs";

type StreamToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  tokens?: { prompt: number; completion: number };
};

type UnifiedStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_start"; toolCall: StreamToolCall }
  | { type: "tool_result"; toolCallId: string; result: string }
  | {
      type: "token_usage";
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: "citations"; citations: string[] }
  | { type: "model_resolved"; routedModel: string }
  | { type: "error"; error: string };

async function* streamAssistantEvents(params: {
  messages: Awaited<
    ReturnType<typeof StreamPipeline.prepareStreamContext>
  >["messages"];
  modelId: string;
  reasoningEffort?: import("@/lib/types").ReasoningEffort;
  imagesForAI: Awaited<
    ReturnType<typeof StreamPipeline.prepareStreamContext>
  >["imagesForAI"];
  customTools: ReturnType<typeof convertCustomToolsToLangChain>;
  forceWebSearch?: boolean;
  userId: string;
  userContext: UserContext;
}): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
  for await (const event of await chatService.streamChat({
    messages: params.messages,
    modelId: params.modelId,
    reasoningEffort: params.reasoningEffort,
    images: params.imagesForAI,
    customTools: params.customTools,
    forceWebSearch: params.forceWebSearch,
    userContext: params.userContext,
  })) {
    if (event.type === "token") {
      yield { type: "token", content: event.content };
    } else if (event.type === "tool_start") {
      yield { type: "tool_start", toolCall: event.toolCall };
    } else if (event.type === "tool_result") {
      yield {
        type: "tool_result",
        toolCallId: event.toolCallId,
        result: event.result,
      };
    } else if (event.type === "token_usage") {
      yield {
        type: "token_usage",
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
      };
    } else if (event.type === "citations") {
      yield { type: "citations", citations: event.citations };
    } else if (event.type === "model_resolved") {
      yield { type: "model_resolved", routedModel: event.routedModel };
    }
  }
}

export async function POST(req: NextRequest) {
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

    const {
      user,
      requestBody,
      threadId: currentThreadId,
      isNewThread,
      messages,
      imagesForAI,
      isFirstMessage,
      isRegeneration,
      regenerateMessageId,
      pairedUserVersionId,
      pairedAssistantVersionId,
      savedUserMessageId,
    } = await StreamPipeline.prepareStreamContext(req);

    const { model, forceWebSearch, message, reasoningEffort } = requestBody;
    const memoryEnabled = requestBody.memoryEnabled ?? true;
    const userId = user.id;

    logger.info(
      "Messages for processing:",
      messages.length,
      messages.map((m) => ({ role: m.role, contentLength: m.content?.length })),
    );

    // Kick off memory retrieval immediately so it runs in parallel with tool loading
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
            const strings = retrievalResult.memories.map(
              (m) => `- ${m.content}`,
            );
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

    const customToolsForAI: ReturnType<typeof convertCustomToolsToLangChain> = [];

    if (memoryEnabled) {
      customToolsForAI.push(
        createSaveMemoryTool(userId, user.name, user.email),
      );
      customToolsForAI.push(createEditMemoryTool(userId));
      customToolsForAI.push(createDeleteMemoryTool(userId));
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const writeEvent = (payload: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        };

        try {
          let fullResponse = "";
          const toolCalls: StreamToolCall[] = [];
          const tokenUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };
          let citations: string[] = [];
          let resolvedRoutedModel: string | undefined;

          if (isNewThread) {
            writeEvent({ type: "thread", threadId: currentThreadId });
          }
          if (savedUserMessageId) {
            writeEvent({
              type: "user_message_saved",
              messageId: savedUserMessageId,
            });
          }

          // Await the memory retrieval that was started in parallel with tool loading
          const memoryStrings = memoryEnabled
            ? await memoryPromise
            : (logger.info("[API] Memory disabled for this request"), []);

          const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";
          let tokenBuffer = "";
          let lastFlushTime = Date.now();
          const FLUSH_INTERVAL = 10; // 10ms — reduced from 30ms for snappier first-token feel

          const flushTokenBuffer = () => {
            if (tokenBuffer) {
              writeEvent({ type: "token", content: tokenBuffer });
              tokenBuffer = "";
              lastFlushTime = Date.now();
            }
          };

          for await (const event of streamAssistantEvents({
            messages,
            modelId: model,
            reasoningEffort,
            imagesForAI,
            customTools: customToolsForAI,
            forceWebSearch,
            userId,
            userContext: {
              userId,
              name: user.name,
              email: user.email,
              timezone,
              memories: memoryStrings,
            },
          })) {
            if (event.type === "token") {
              fullResponse += event.content;
              tokenBuffer += event.content;
              if (Date.now() - lastFlushTime >= FLUSH_INTERVAL) {
                flushTokenBuffer();
              }
            } else {
              flushTokenBuffer();
              if (event.type === "tool_start") {
                toolCalls.push(event.toolCall);
                writeEvent({ type: "tool_start", toolCall: event.toolCall });
              } else if (event.type === "tool_result") {
                const toolCallIndex = toolCalls.findIndex(
                  (toolCall) => toolCall.id === event.toolCallId,
                );
                if (toolCallIndex !== -1) {
                  toolCalls[toolCallIndex].result = event.result;
                  try {
                    const parsed = JSON.parse(event.result);
                    if (parsed._tokens) {
                      toolCalls[toolCallIndex].tokens = parsed._tokens;
                    }
                    if (parsed._artifact) {
                      saveToolArtifact(userId, parsed._artifact, currentThreadId).catch(() => {});
                    }
                    if (parsed._artifacts) {
                      for (const a of parsed._artifacts) {
                        saveToolArtifact(userId, a, currentThreadId).catch(() => {});
                      }
                    }
                  } catch {
                    // result is not JSON or has no token data
                  }
                }
                writeEvent({
                  type: "tool_result",
                  toolCallId: event.toolCallId,
                  result: event.result,
                });
              } else if (event.type === "token_usage") {
                tokenUsage.promptTokens += event.promptTokens;
                tokenUsage.completionTokens += event.completionTokens;
                tokenUsage.totalTokens += event.totalTokens;
                writeEvent({
                  type: "token_usage",
                  promptTokens: event.promptTokens,
                  completionTokens: event.completionTokens,
                  totalTokens: event.totalTokens,
                });
              } else if (event.type === "citations") {
                citations = event.citations;
                writeEvent({ type: "citations", citations: event.citations });
              } else if (event.type === "model_resolved") {
                resolvedRoutedModel = event.routedModel;
                writeEvent({
                  type: "model_resolved",
                  routedModel: event.routedModel,
                });
              } else if (event.type === "error") {
                throw new Error(event.error);
              }
            }
          }
          flushTokenBuffer();

          const fallbackPrompt = Math.max(
            1,
            Math.ceil(((requestBody.message as string) || "").length / 4),
          );
          const fallbackCompletion = Math.max(
            1,
            Math.ceil(fullResponse.length / 4),
          );
          if (tokenUsage.totalTokens === 0) {
            writeEvent({
              type: "token_usage",
              promptTokens: fallbackPrompt,
              completionTokens: fallbackCompletion,
              totalTokens: fallbackPrompt + fallbackCompletion,
            });
          }

          const assistantPayload = {
            versionId: pairedAssistantVersionId,
            content: fullResponse,
            model,
            routedModel: resolvedRoutedModel,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens:
              tokenUsage.totalTokens > 0
                ? {
                    prompt: tokenUsage.promptTokens,
                    completion: tokenUsage.completionTokens,
                  }
                : {
                    prompt: fallbackPrompt,
                    completion: fallbackCompletion,
                  },
            citations: citations.length > 0 ? citations : undefined,
            pairedUserVersionId: pairedUserVersionId,
          };
          const savedMessage =
            isRegeneration && regenerateMessageId
              ? await store.appendMessageVersion(
                  currentThreadId,
                  regenerateMessageId,
                  assistantPayload,
                )
              : await store.addMessage(currentThreadId, {
                  threadId: currentThreadId,
                  userId,
                  userName: user.name,
                  userEmail: user.email,
                  role: "assistant",
                  ...assistantPayload,
                });

          if (!savedMessage) {
            throw new Error("Failed to persist regenerated message version");
          }

          writeEvent({ type: "message_saved", messageId: savedMessage.id });
          await StreamPipeline.generateTitleIfNeeded(
            currentThreadId,
            isFirstMessage,
            encoder,
            controller,
          );

          writeEvent({ type: "done" });
          controller.close();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "An error occurred";
          logger.error({ err: error }, "Streaming error");
          writeEvent({ type: "error", error: errorMessage });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Chat stream error");
    return handleError(error, "Chat stream");
  }
}
