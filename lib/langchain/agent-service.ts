import "server-only";
import { logger } from "@/lib/logger";
import { createAgent } from "langchain";
import {
  SystemMessage,
} from "@langchain/core/messages";
import { Message, MCPServerConfig } from "../types";
import { createMCPClient } from "./langchain-mcp";
import { StructuredToolInterface } from "@langchain/core/tools";
import { getModel } from "./model-factory";
import { ModelOptions } from "./model-config";
import defaultToolsMap from "../tool/default-tools";
import { replacePromptVariables, UserContext } from "./langchain-utility";
import {
  convertToLangChainMessages,
  extractTextFromContent,
  filterValidMessages,
} from "./langchain-message-utils";

// Event types for streaming
export interface AgentStreamEvent {
  type:
    | "token"
    | "tool_call_start"
    | "tool_call_end"
    | "tool_result"
    | "token_usage"
    | "error"
    | "done"
    | "citations";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  citations?: string[];
}

export class AgentService {
  async *streamAgent(params: {
    messages: Message[];
    modelId: string;
    systemPrompt: string;
    mcpServers?: MCPServerConfig[];
    allowedTools?: string[];
    customTools?: StructuredToolInterface[];
    images?: { base64Data: string; mimeType: string }[];
    modelOptions?: Pick<ModelOptions, "temperature" | "topP">;
    userContext?: UserContext;
  }): AsyncGenerator<AgentStreamEvent, void, unknown> {
    // Validate messages
    if (!params.messages || !Array.isArray(params.messages)) {
      yield { type: "error", error: "Messages must be a valid array" };
      return;
    }

    const validMessages = filterValidMessages(params.messages);

    if (validMessages.length === 0) {
      yield { type: "error", error: "No valid messages to process" };
      return;
    }

    let mcpClient: ReturnType<typeof createMCPClient> = null;

    try {
      const model = getModel(params.modelId, params.modelOptions);
      const langChainMessages = convertToLangChainMessages({
        messages: validMessages,
        images: params.images,
      });
      const processedSystemPrompt = replacePromptVariables(
        params.systemPrompt,
        params.userContext,
      );
      langChainMessages.unshift(new SystemMessage(processedSystemPrompt));

      // Get MCP tools if servers are provided
      let tools: StructuredToolInterface[] = [];
      if (params.mcpServers && params.mcpServers.length > 0) {
        mcpClient = createMCPClient(params.mcpServers);
        if (mcpClient) {
          try {
            // mcpServers are already pre-filtered upstream by allowed server selection.
            // Load all tools from those servers to avoid runtime failures when the model
            // requests a sibling tool from the same server (e.g. auth/introspection tools).
            tools = await mcpClient.getTools();

            logger.info(`Loaded ${tools.length} MCP tools for agent`);
          } catch (toolError) {
            logger.warn("Failed to load MCP tools:", toolError);
          }
        }
      }

      // Also load default tools if allowed
      if (params.allowedTools && params.allowedTools.length > 0) {
        const defaultToolsToLoad = params.allowedTools
          .filter((t) => t.startsWith("default:"))
          .map((t) => t.split(":")[1])
          .map((name) => defaultToolsMap[name])
          .filter((t): t is NonNullable<typeof t> => t !== undefined);

        if (defaultToolsToLoad.length > 0) {
          logger.info(
            `Loaded ${defaultToolsToLoad.length} default tools for agent`,
          );
          tools = [...tools, ...defaultToolsToLoad];
        }
      }

      if (params.customTools && params.customTools.length > 0) {
        const existingToolNames = new Set(tools.map((tool) => tool.name));
        const uniqueCustomTools = params.customTools.filter(
          (tool) => !existingToolNames.has(tool.name),
        );
        if (uniqueCustomTools.length > 0) {
          logger.info(
            `Loaded ${uniqueCustomTools.length} custom tools for agent`,
          );
          tools = [...tools, ...uniqueCustomTools];
        }
      }

      // Always load essential tools that are marked as alwaysEnabled (e.g., knowledge_base_search)
      const { DEFAULT_TOOLS_METADATA } =
        await import("../tool/default-tools-metadata");
      const alwaysEnabledToolNames = DEFAULT_TOOLS_METADATA.filter(
        (t) => t.alwaysEnabled,
      ).map((t) => t.name);

      for (const toolName of alwaysEnabledToolNames) {
        if (tools.some((t) => t.name === toolName)) continue;
        const resolved = defaultToolsMap[toolName];
        if (resolved) {
          logger.info(`Auto-loading always-enabled tool: ${toolName}`);
          tools.push(resolved);
        }
      }

      // Create agent with or without tools
      const agent = createAgent({
        model: model,
        tools: tools,
      });

      // Stream the agent response using "updates" mode to get complete messages
      // "messages" mode streams args incrementally (empty at first), "updates" gives full messages
      const stream = await agent.stream(
        { messages: langChainMessages },
        { streamMode: "updates", recursionLimit: 100 },
      );

      // Track which tool calls we've already emitted to avoid duplicates
      const emittedToolCallIds = new Set<string>();

      for await (const chunk of stream) {
        // Handle object-style chunks (from updates mode)
        const chunkObj = chunk as Record<string, unknown>;
        // logger.info("Stream chunk keys:", Object.keys(chunkObj));
        // logger.info("Full chunk:", JSON.stringify(chunkObj, null, 2).slice(0, 3000));

        // Handle "model_request" key (LangGraph createAgent structure)
        if ("model_request" in chunkObj && chunkObj.model_request) {
          const modelRequest = chunkObj.model_request as {
            messages?: unknown[];
          };
          if (modelRequest.messages && Array.isArray(modelRequest.messages)) {
            for (const msg of modelRequest.messages) {
              if (msg && typeof msg === "object") {
                // Yield text content
                if ("content" in msg) {
                  const content = extractTextFromContent(
                    (msg as { content: unknown }).content,
                  );
                  if (content) {
                    yield { type: "token", content };
                  }
                }

                // Check for tool calls
                if (
                  "tool_calls" in msg &&
                  Array.isArray((msg as { tool_calls: unknown[] }).tool_calls)
                ) {
                  const toolCalls = (msg as { tool_calls: unknown[] })
                    .tool_calls;
                  for (const toolCall of toolCalls) {
                    if (
                      toolCall &&
                      typeof toolCall === "object" &&
                      "name" in toolCall
                    ) {
                      const tc = toolCall as {
                        name: string;
                        args?: Record<string, unknown>;
                        id?: string;
                      };

                      if (tc.id && emittedToolCallIds.has(tc.id)) {
                        continue;
                      }
                      if (tc.id) {
                        emittedToolCallIds.add(tc.id);
                      }

                      const toolArgs = tc.args || {};
                      logger.info(
                        "Tool call (model_request):",
                        tc.name,
                        "args:",
                        JSON.stringify(toolArgs),
                      );

                      yield {
                        type: "tool_call_start",
                        toolCallId: tc.id,
                        toolName: tc.name,
                        toolArgs: toolArgs,
                      };
                    }
                  }
                }
              }
            }
          }
        }

        if ("agent" in chunkObj && chunkObj.agent) {
          const agentOutput = chunkObj.agent as { messages?: unknown[] };
          if (agentOutput.messages && Array.isArray(agentOutput.messages)) {
            for (const msg of agentOutput.messages) {
              if (msg && typeof msg === "object") {
                // Yield text content
                if ("content" in msg) {
                  const content = extractTextFromContent(
                    (msg as { content: unknown }).content,
                  );
                  if (content) {
                    yield { type: "token", content };
                  }
                }

                const msgObj = msg as {
                  usage_metadata?: Record<string, number | undefined>;
                  response_metadata?: {
                    tokenUsage?: Record<string, number | undefined>;
                    usage?: Record<string, number | undefined>;
                    prompt_eval_count?: number;
                    eval_count?: number;
                  };
                };
                const msgUsage = msgObj.usage_metadata || msgObj.response_metadata?.tokenUsage || msgObj.response_metadata?.usage;
                const pTokens = msgUsage?.input_tokens ?? msgUsage?.prompt_tokens ?? msgUsage?.promptTokens ?? msgObj.response_metadata?.prompt_eval_count ?? 0;
                const cTokens = msgUsage?.output_tokens ?? msgUsage?.completion_tokens ?? msgUsage?.completionTokens ?? msgObj.response_metadata?.eval_count ?? 0;
                const tTokens = msgUsage?.total_tokens ?? msgUsage?.totalTokens ?? (pTokens + cTokens);
                if (tTokens > 0) {
                  yield {
                    type: "token_usage",
                    promptTokens: pTokens,
                    completionTokens: cTokens,
                    totalTokens: tTokens,
                  };
                }

                if (
                  "tool_calls" in msg &&
                  Array.isArray((msg as { tool_calls: unknown[] }).tool_calls)
                ) {
                  const toolCalls = (msg as { tool_calls: unknown[] })
                    .tool_calls;
                  for (const toolCall of toolCalls) {
                    if (
                      toolCall &&
                      typeof toolCall === "object" &&
                      "name" in toolCall
                    ) {
                      const tc = toolCall as {
                        name: string;
                        args?: Record<string, unknown>;
                        id?: string;
                      };

                      // Skip if we've already emitted this tool call
                      if (tc.id && emittedToolCallIds.has(tc.id)) {
                        continue;
                      }
                      if (tc.id) {
                        emittedToolCallIds.add(tc.id);
                      }

                      const toolArgs = tc.args || {};
                      logger.info(
                        "Tool call (updates mode):",
                        tc.name,
                        "args:",
                        JSON.stringify(toolArgs),
                      );

                      yield {
                        type: "tool_call_start",
                        toolCallId: tc.id,
                        toolName: tc.name,
                        toolArgs: toolArgs,
                      };
                    }
                  }
                }
              }
            }
          }
        }

        if ("tools" in chunkObj && chunkObj.tools) {
          const toolsOutput = chunkObj.tools as { messages?: unknown[] };
          if (toolsOutput.messages && Array.isArray(toolsOutput.messages)) {
            for (const msg of toolsOutput.messages) {
              if (msg && typeof msg === "object" && "content" in msg) {
                // Handle content that could be string, object, or array
                let resultStr = "";
                const rawContent = (msg as { content: unknown }).content;
                const toolCallId =
                  "tool_call_id" in msg &&
                  typeof (msg as { tool_call_id?: unknown }).tool_call_id ===
                    "string"
                    ? (msg as { tool_call_id: string }).tool_call_id
                    : undefined;
                if (typeof rawContent === "string") {
                  resultStr = rawContent;
                } else if (rawContent !== null && rawContent !== undefined) {
                  resultStr = JSON.stringify(rawContent, null, 2);
                }
                yield {
                  type: "tool_result",
                  toolCallId,
                  toolResult: resultStr,
                };

                // Try to extract citations from tool result
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
                      } as AgentStreamEvent; // Cast because distinct type in union
                    }
                  }
                } catch {
                  // Ignore parsing errors
                }
              }
            }
          }
        }

        // Yield token usage from the last chunk if available
        if ("usage_metadata" in chunkObj && chunkObj.usage_metadata) {
          const usage = chunkObj.usage_metadata as {
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          };
          logger.info("Agent Token Usage:", {
            model: params.modelId,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
          });

          yield {
            type: "token_usage",
            promptTokens: usage.input_tokens ?? 0,
            completionTokens: usage.output_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          };
        }
      }

      yield { type: "done" };
    } catch (error) {
      logger.error("Agent streaming error:", error);
      yield {
        type: "error",
        error:
          error instanceof Error ? error.message : "An unknown error occurred",
      };
    } finally {
      if (mcpClient) {
        try {
          await mcpClient.close();
          logger.info("Closed MCP client for agent stream");
        } catch (closeError) {
          logger.warn("Failed to close MCP client:", closeError);
        }
      }
    }
  }
}

// Singleton instance
export const agentService = new AgentService();
