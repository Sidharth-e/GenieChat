import "server-only";
import { logger } from "@/lib/logger";
import {
  SystemMessage,
  ToolMessage,
  AIMessageChunk,
} from "@langchain/core/messages";
import { StructuredTool } from "langchain";
import { Message } from "../types";
import defaultToolsMap, { defaultTools } from "../tool/default-tools";
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
    customTools?: StructuredTool[];
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
    | { type: "citations"; citations: string[] },
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

    // Merge default tools with custom tools, avoiding duplicates
    // Filter out custom tools that have the same name as default tools
    const customToolsFiltered = (params.customTools ?? []).filter(
      (customTool) => !defaultToolsMap[customTool.name],
    );

    if (
      params.customTools &&
      customToolsFiltered.length !== params.customTools.length
    ) {
      const duplicates = params.customTools
        .filter((ct) => defaultToolsMap[ct.name])
        .map((ct) => ct.name);
      logger.warn(
        `Skipping custom tools with duplicate names: ${duplicates.join(", ")}`,
      );
    }

    // `knowledge_base_search` has left `defaultTools` for a per-request factory,
    // so it is no longer a `defaultToolsMap` key and the duplicate-name check
    // above can no longer catch a custom tool that shadows it. This set is what
    // keeps the name reserved, and it stays until custom tools can be
    // owner-scoped too.
    const agentOnlyTools = new Set(["knowledge_base_search"]);
    const chatCustomTools = customToolsFiltered.filter((t) => !agentOnlyTools.has(t.name));
    const allTools = [...defaultTools, ...chatCustomTools];

    // Not every model supports tool binding (e.g. deepseek-r1 has supportsTools: false).
    const modelWithTools = model.bindTools ? model.bindTools(allTools) : model;

    // Build a combined tools map for execution lookup
    const allToolsMap: Record<string, StructuredTool> = {};
    for (const t of allTools) {
      allToolsMap[t.name] = t;
    }

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

    try {
      for (;;) {
        const stream = await modelWithTools.stream(langChainMessages);
        let finalChunk: AIMessageChunk | null = null;
        let emittedContent = false;

        for await (const chunk of stream) {
          // Accumulate the chunk to construct the full message
          if (!finalChunk) {
            finalChunk = chunk;
          } else {
            finalChunk = finalChunk.concat(chunk);
          }

          // Yield content to the UI as it streams
          const content = extractTextFromContent(chunk.content);
          if (content) {
            emittedContent = true;
            yield { type: "token", content };
          }
        }

        if (!finalChunk) {
          break;
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
        const content = extractTextFromContent(response.content);
        if (content) {
          yield { type: "token", content };
        }
      } catch (invokeError) {
        logger.error("Both streaming and invoke failed:", invokeError);
        throw invokeError;
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
