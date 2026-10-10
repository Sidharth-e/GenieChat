import "server-only";
import { logger } from "@/lib/logger";
import {
  SystemMessage,
  ToolMessage,
  AIMessageChunk,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Message, ConnectorConfig } from "../types";
import defaultToolsMap, {
  createCodeSandboxTool,
  webSearch,
} from "../tool/default-tools";
import {
  createGenerateImageTool,
  createGenerateVideoTool,
} from "../tool/generation-tools";
import { createMCPClient } from "./langchain-mcp";
import { getModel } from "./model-factory";
import {
  generateResponse,
  replacePromptVariables,
  UserContext,
} from "./langchain-utility";
import {
  convertToLangChainMessages,
  extractTextFromContent,
  filterValidMessages,
} from "./langchain-message-utils";
import { config } from "../config";

export class ChatService {
  async *streamChat(params: {
    messages: Message[];
    modelId: string;
    reasoningEffort?: import("../types").ReasoningEffort;
    images?: { base64Data: string; mimeType: string }[];
    customTools?: StructuredToolInterface[];
    /**
     * Already filtered and secret-resolved upstream by `filterConnectors`. Chat
     * is the one surface that binds every enabled server, because it has no
     * agent record to scope them with.
     */
    connectors?: ConnectorConfig[];
    forceWebSearch?: boolean;
    userContext?: UserContext;
  }): AsyncGenerator<
    | { type: "token"; content: string }
    | {
        type: "tool_start";
        toolCall: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
      }
    | { type: "tool_result"; toolCallId: string; result: string }
    | {
        type: "token_usage";
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | { type: "citations"; citations: string[] }
    | { type: "model_resolved"; routedModel: string },
    void,
    unknown
  > {
    // Defensive: ensure messages is an array
    if (!params.messages || !Array.isArray(params.messages)) {
      logger.error("Invalid messages:", params.messages);
      throw new Error("Messages must be a valid array");
    }

    // Filter out any undefined/null messages before processing
    const validMessages = filterValidMessages(params.messages);

    logger.info(
      "Processing messages:",
      validMessages.map((m) => ({
        role: m.role,
        contentLength: m.content?.length,
      })),
    );

    if (validMessages.length === 0) {
      throw new Error("No valid messages to process");
    }
    const model = getModel(params.modelId, {
      temperature: config.chat.defaultChatTemperature,
      reasoningEffort: params.reasoningEffort,
    });

    // `knowledge_base_search`, `generate_image` and `generate_video` have left
    // `defaultTools` for per-request factories, so none is a `defaultToolsMap`
    // key any more and a custom tool shadowing one would go unnoticed. This set
    // is what keeps their names reserved, and it stays until custom tools can be
    // owner-scoped too. `knowledge_base_search` is kept off the chat surface as
    // well — it searches one agent's documents, and chat has no agent.
    const reservedToolNames = new Set([
      "knowledge_base_search",
      "generate_image",
      "generate_video",
    ]);
    const chatCustomTools = (params.customTools ?? []).filter(
      (t) => !reservedToolNames.has(t.name),
    );
    const activeCodeSandbox = params.userContext?.userId
      ? createCodeSandboxTool(params.userContext.userId, params.userContext.threadId)
      : defaultToolsMap.code_sandbox;
    // Bound, like the sandbox, only where there is a user to own the result and
    // pay the provider — a generation with no owner cannot be stored.
    const activeImageTool = params.userContext?.userId
      ? createGenerateImageTool(
          params.userContext.userId,
          params.userContext.threadId,
        )
      : null;
    const activeVideoTool = params.userContext?.userId
      ? createGenerateVideoTool(
          params.userContext.userId,
          params.userContext.threadId,
        )
      : null;
    const defaultToolsForChat = [
      webSearch,
      activeCodeSandbox,
      ...(activeImageTool ? [activeImageTool] : []),
      ...(activeVideoTool ? [activeVideoTool] : []),
    ];

    // Built outside the `try` below, because the streaming `catch` reaches for
    // this array when it falls back to `invoke`.
    const langChainMessages = convertToLangChainMessages({
      messages: validMessages,
      images: params.images,
    });

    // Build system prompt with optional web search instruction
    let systemPrompt = replacePromptVariables(
      config.chat.defaultChatSystemPrompt,
      params.userContext,
    );
    if (params.forceWebSearch) {
      systemPrompt +=
        "\n\nIMPORTANT: The user has enabled web search mode. You MUST use the web_search tool to search the internet for information before responding. Always search first, then synthesize the results into your response.";
    }
    langChainMessages.unshift(new SystemMessage(systemPrompt));

    // An MCP client holds a live connection, so it is opened inside the `try`
    // below and torn down in the `finally` — a throw anywhere past that point,
    // the streaming fallback included, must not leak it.
    let mcpClient: ReturnType<typeof createMCPClient> = null;

    try {
      // A server that will not answer costs its own tools and nothing else, as
      // a failing connector does on the agent surface.
      const connectorTools: StructuredToolInterface[] = [];
      if (params.connectors && params.connectors.length > 0) {
        mcpClient = createMCPClient(params.connectors);
        if (mcpClient) {
          try {
            connectorTools.push(...(await mcpClient.getTools()));
            logger.info(`Loaded ${connectorTools.length} MCP tools for chat`);
          } catch (toolError) {
            logger.warn("Failed to load MCP tools:", toolError);
          }
        }
      }

      // One name, one tool. A duplicate is dropped rather than bound twice,
      // because two tools sharing a name reach the model as a single ambiguous
      // choice — the same check the agent service makes, in the same order:
      // defaults win outright, then connectors, then the user's own tools.
      const reservedNames = new Set([
        ...Object.keys(defaultToolsMap),
        ...connectorTools.map((t) => t.name),
      ]);
      const uniqueCustomTools = chatCustomTools.filter(
        (t) => !reservedNames.has(t.name),
      );
      if (uniqueCustomTools.length !== chatCustomTools.length) {
        const duplicates = chatCustomTools
          .filter((t) => reservedNames.has(t.name))
          .map((t) => t.name);
        logger.warn(
          `Skipping custom tools with duplicate names: ${duplicates.join(", ")}`,
        );
      }

      const allTools: StructuredToolInterface[] = [
        ...defaultToolsForChat,
        ...connectorTools,
        ...uniqueCustomTools,
      ];

      const modelWithTools = model.bindTools ? model.bindTools(allTools) : model;

      const allToolsMap: Record<string, StructuredToolInterface> = {};
      for (const t of allTools) {
        allToolsMap[t.name] = t;
      }

      let resolvedRoutedModel: string | undefined;

      for (;;) {
        const stream = await modelWithTools.stream(langChainMessages);
        let finalChunk: AIMessageChunk | null = null;
        let emittedContent = false;

        for await (const chunk of stream) {
          const rawMetadata = chunk.response_metadata as Record<string, unknown> | undefined;
          const modelRouted =
            (model as unknown as { lastRoutedModel?: string }).lastRoutedModel ||
            (modelWithTools as unknown as { bound?: { lastRoutedModel?: string } })?.bound?.lastRoutedModel;
          const chunkModel = (rawMetadata?.model ||
            rawMetadata?.model_name ||
            (chunk.additional_kwargs as Record<string, unknown>)?.model ||
            modelRouted) as string | undefined;
          if (chunkModel && typeof chunkModel === "string" && chunkModel !== resolvedRoutedModel) {
            resolvedRoutedModel = chunkModel;
            yield { type: "model_resolved", routedModel: chunkModel };
          }

          if (!finalChunk) {
            finalChunk = chunk;
          } else {
            finalChunk = finalChunk.concat(chunk);
          }

          const content = extractTextFromContent(chunk.content);
          if (content) {
            emittedContent = true;
            yield { type: "token", content };
          }
        }

        if (!finalChunk) {
          break;
        }

        if (!resolvedRoutedModel) {
          const finalMetadata = finalChunk.response_metadata as Record<string, unknown> | undefined;
          const modelRouted =
            (model as unknown as { lastRoutedModel?: string }).lastRoutedModel ||
            (modelWithTools as unknown as { bound?: { lastRoutedModel?: string } })?.bound?.lastRoutedModel;
          const finalModel = (finalMetadata?.model ||
            finalMetadata?.model_name ||
            (finalChunk.additional_kwargs as Record<string, unknown>)?.model ||
            modelRouted) as string | undefined;
          if (finalModel && typeof finalModel === "string") {
            resolvedRoutedModel = finalModel;
            yield { type: "model_resolved", routedModel: finalModel };
          }
        }

        if (!emittedContent) {
          const finalContent = extractTextFromContent(finalChunk.content);
          if (finalContent) {
            yield { type: "token", content: finalContent };
          }
        }

        // Check for tool calls in the final accumulated message
        // Note: finalChunk.tool_calls is populated by .concat() in newer langchain versions
        if (finalChunk.tool_calls && finalChunk.tool_calls.length > 0) {
          // Add the assistant's request (with tool calls) to history
          langChainMessages.push(finalChunk);

          logger.debug({ count: finalChunk.tool_calls.length }, "Tool calls detected");

          // Execute all tool calls
          for (const toolCall of finalChunk.tool_calls) {
            const tool = allToolsMap[toolCall.name];
            if (tool) {
              logger.debug({ tool: toolCall.name }, "Executing tool");

              // Yield tool start event
              yield {
                type: "tool_start",
                toolCall: {
                  id: toolCall.id!,
                  name: toolCall.name,
                  arguments: toolCall.args,
                },
              };

              try {
                const result = await tool.invoke(
                  toolCall.args as Record<string, unknown>,
                );
                const resultStr = String(result);

                langChainMessages.push(
                  new ToolMessage({
                    tool_call_id: toolCall.id!,
                    content: resultStr,
                  }),
                );

                // Yield tool result event
                yield {
                  type: "tool_result",
                  toolCallId: toolCall.id!,
                  result: resultStr,
                };

                // Try to extract citations from tool result (e.g. from web_search)
                try {
                  if (
                    resultStr.startsWith("{") &&
                    resultStr.includes("citations")
                  ) {
                    const parsed = JSON.parse(resultStr);
                    if (
                      parsed.citations &&
                      Array.isArray(parsed.citations) &&
                      parsed.citations.length > 0
                    ) {
                      yield {
                        type: "citations",
                        citations: parsed.citations,
                      };
                    }
                  }
                } catch {
                  // Ignore parsing errors
                }
              } catch (error) {
                logger.error(`Error executing tool ${toolCall.name}:`, error);
                const errorStr = `Error executing tool: ${error instanceof Error ? error.message : "Unknown error"}`;
                langChainMessages.push(
                  new ToolMessage({
                    tool_call_id: toolCall.id!,
                    content: errorStr,
                  }),
                );

                yield {
                  type: "tool_result",
                  toolCallId: toolCall.id!,
                  result: errorStr,
                };
              }
            } else {
              logger.warn(`Tool ${toolCall.name} not found`);
              const errorStr = `Error: Tool "${toolCall.name}" not found.`;
              langChainMessages.push(
                new ToolMessage({
                  tool_call_id: toolCall.id!,
                  content: errorStr,
                }),
              );
              yield {
                type: "tool_result",
                toolCallId: toolCall.id!,
                result: errorStr,
              };
            }
          }
          // Loop continues to let the model generate a response to the tool results
        } else {
          // No more tool calls, we are done
          // Yield token usage if available
          if (finalChunk.usage_metadata) {
            logger.info("Token Usage:", {
              model: params.modelId,
              input_tokens: finalChunk.usage_metadata.input_tokens,
              output_tokens: finalChunk.usage_metadata.output_tokens,
              total_tokens: finalChunk.usage_metadata.total_tokens,
            });

            yield {
              type: "token_usage",
              promptTokens: finalChunk.usage_metadata.input_tokens ?? 0,
              completionTokens: finalChunk.usage_metadata.output_tokens ?? 0,
              totalTokens: finalChunk.usage_metadata.total_tokens ?? 0,
            };
          }

          break;
        }
      }
    } catch (streamError) {
      logger.warn("Streaming failed, falling back to invoke:", streamError);
      // Fallback to non-streaming invoke if streaming fails
      try {
        const response = await model.invoke(langChainMessages);
        const respMetadata = (response as AIMessageChunk).response_metadata as Record<string, unknown> | undefined;
        const modelRouted = (model as unknown as { lastRoutedModel?: string }).lastRoutedModel;
        const respModel = (respMetadata?.model || respMetadata?.model_name || modelRouted) as string | undefined;
        if (respModel && typeof respModel === "string") {
          yield { type: "model_resolved", routedModel: respModel };
        }
        const content = extractTextFromContent(response.content);
        if (content) {
          yield { type: "token", content };
        }
      } catch (invokeError) {
        logger.error("Both streaming and invoke failed:", invokeError);
        throw invokeError;
      }
    } finally {
      if (mcpClient) {
        try {
          await mcpClient.close();
          logger.info("Closed MCP client for chat stream");
        } catch (closeError) {
          logger.warn("Failed to close MCP client:", closeError);
        }
      }
    }
  }

  async generateTitle(messages: Message[]): Promise<string> {
    const model = getModel(config.chat.titleGenerationModel, {
      temperature: config.chat.titleGenerationTemperature,
    });
    const validMessages = messages.filter((m) => m && m.role && m.content); // Filter out undefined/malformed messages

    // If no valid messages, return a default title
    if (validMessages.length === 0) {
      return "New Chat";
    }
    const conversationSummary = validMessages
      .slice(0, 4)
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join("\n");

    // Double-check that we have content to send
    if (!conversationSummary.trim()) {
      return "New Chat";
    }

    const response = await generateResponse(
      config.chat.threadTitlePrompt,
      conversationSummary,
      model,
    );

    return (response as string).trim().slice(0, 50);
  }
}

// Singleton instance
export const chatService = new ChatService();
