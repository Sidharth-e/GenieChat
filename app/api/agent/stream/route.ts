import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { agentService } from "@/lib/langchain/agent-service";
import { store } from "@/lib/store";
import { MCPServerConfig, Agent, ToolSecret } from "@/lib/types";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { convertCustomToolToLangChain } from "@/lib/tool/custom-tool-converter";
import { StreamPipeline } from "@/lib/api/stream-pipeline";
import { handleError, api } from "@/lib/api-utils";
import { generateId } from "@/lib/utils";
import { StructuredToolInterface } from "@langchain/core/tools";
import { createUseSkillTool } from "@/lib/tool/default-tools";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { saveToolArtifact } from "@/lib/artifacts/save";

export const runtime = "nodejs";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

// Helper functions moved to @/lib/api/stream-helper

function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(req, {
      namespace: "agent_stream",
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
    } = await StreamPipeline.prepareStreamContext(req, false, "[AgentStream]");

    const { model, agentId, systemPrompt, temperature, topP } = requestBody;
    const userId = user.id;

    logger.info("Agent messages for processing:", messages.length);

    // Get agent configuration and relevant MCP servers
    let allowedTools: string[] | undefined;
    let mcpServers: MCPServerConfig[] = [];
    let currentAgent: Agent | null = null;
    let customToolsForAgent: StructuredToolInterface[] = [];

    let effectiveSystemPrompt: string = systemPrompt ?? "";
    let effectiveTemperature: number | undefined = temperature;
    let effectiveTopP: number | undefined = topP;

    if (agentStore && mcpStore) {
      try {
        // Single round: secrets, agent config, tools, and MCP servers are all independent
        const secretStore = new SecretStore();
        const toolStore = new ToolStore();
        // type ToolList = Awaited<ReturnType<typeof toolStore.getTools>>;
        const [userSecrets, fetchedAgent, userCustomTools, allServers] =
          await Promise.all([
            isDatabaseConfigured()
              ? secretStore.getSecrets(userId)
              : Promise.resolve([] as ToolSecret[]),
            agentId ? agentStore.getAgent(agentId) : Promise.resolve(null),
            toolStore.getTools(userId),
            mcpStore.getMCPServers(userId),
          ]);

        const secretMap = userSecrets.reduce(
          (acc, secret) => {
            acc[secret.name] = secret.value;
            return acc;
          },
          {} as Record<string, string>,
        );

        if (fetchedAgent) {
          currentAgent = fetchedAgent;

          if (!currentAgent.active) {
            return api.forbidden("This agent has been disabled.");
          }

          effectiveTemperature ??= currentAgent.temperature;
          effectiveTopP ??= currentAgent.topP;

          const identityPrompt = `\n\nSYSTEM INFO:\nYou are an AI agent named "${currentAgent.name}".\nYour Agent ID is "${currentAgent.id}".\nIf you need to search your knowledge base using the 'knowledge_base_search' tool, you SHOULD provide this Agent ID to filter results specific to you.`;

          effectiveSystemPrompt =
            (effectiveSystemPrompt || "") + identityPrompt;
          currentAgent.systemPrompt =
            (currentAgent.systemPrompt || "") + identityPrompt;

          if (currentAgent.skills && currentAgent.skills.length > 0) {
            const catalog = currentAgent.skills
              .map((s) => `- **${s.name}**: ${s.description}`)
              .join("\n");
            const skillCatalogBlock = `\n\n# Available Skills\n\nYou have the following skills available. To activate a skill and receive its full instructions, call the \`use_skill\` tool with the skill name.\n\n${catalog}`;
            effectiveSystemPrompt += skillCatalogBlock;
            currentAgent.systemPrompt =
              (currentAgent.systemPrompt || "") + skillCatalogBlock;
          }

          if (currentAgent.tools && currentAgent.tools.length > 0) {
            allowedTools = currentAgent.tools;
            logger.info(`Agent allows ${allowedTools.length} tools`);
          }
        }
        logger.info(`Allowed tools: ${allowedTools?.join(", ")}`);

        if ((currentAgent?.tools?.length ?? 0) > 0) {
          try {
            const allowedSet = new Set(currentAgent!.tools);
            const selectedCustomTools = userCustomTools.filter((tool) => {
              const aliases = [
                `custom:${tool.id}`,
                `custom:${tool.name}`,
                tool.id,
                tool.name,
                toSnakeCase(tool.name),
              ];
              return aliases.some((alias) => allowedSet.has(alias));
            });

            customToolsForAgent = selectedCustomTools
              .filter((tool) => tool.enabled)
              .map((tool) => convertCustomToolToLangChain(tool, secretMap));

            if (customToolsForAgent.length > 0) {
              logger.info(
                `Loaded ${customToolsForAgent.length} custom tools for agent`,
              );
            }
          } catch (err) {
            logger.warn("Failed to load custom tools for agent:", err);
          }
        }

        logger.info(`All servers: ${allServers.map((s) => s.name).join(", ")}`);
        const enabledServers = allServers.filter(
          (s: MCPServerConfig) => s.enabled,
        );
        logger.info(
          `Enabled servers: ${enabledServers.map((s) => s.name).join(", ")}`,
        );

        // 4. Filter servers if we have allowed tools
        if (allowedTools && allowedTools.length > 0) {
          const allowedServerNames = new Set(
            allowedTools
              .map((t) => {
                const parts = t.split(":");
                return parts.length > 1 ? parts[0] : null;
              })
              .filter(Boolean),
          );
          logger.info(
            `Allowed server names: ${Array.from(allowedServerNames).join(", ")}`,
          );

          if (allowedServerNames.size > 0) {
            mcpServers = enabledServers.filter((s) =>
              allowedServerNames.has(s.name),
            );
          } else {
            mcpServers = enabledServers;
          }

          logger.info(
            `Filtered MCP servers to: ${mcpServers.map((s) => s.name).join(", ")}`,
          );
        } else if (allowedTools && allowedTools.length === 0) {
          mcpServers = [];
        }

        mcpServers = resolveMCPServerSecrets(mcpServers, secretMap);
      } catch (err) {
        logger.warn("Error fetching agent settings or MCP servers:", err);
      }
    }

    // Register dynamic use_skill tool when the agent has skills configured
    if (currentAgent?.skills && currentAgent.skills.length > 0) {
      const useSkillTool = createUseSkillTool(currentAgent.skills);
      customToolsForAgent = [...customToolsForAgent, useSkillTool];
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullResponse = "";
          const sourceToUiToolCallId = new Map<string, string>();
          const pendingToolCallIds: string[] = [];

          // Keep track of tool calls and citations to save them
          const toolCalls: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
            result?: string;
            tokens?: { prompt: number; completion: number };
          }[] = [];
          let citations: string[] = [];
          const tokenUsage = { prompt: 0, completion: 0, total: 0 };

          // Send thread ID first for new threads
          if (isNewThread) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "thread", threadId: currentThreadId })}\n\n`,
              ),
            );
          }
          if (savedUserMessageId) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "user_message_saved", messageId: savedUserMessageId })}\n\n`,
              ),
            );
          }

          let tokenBuffer = "";
          let lastFlushTime = Date.now();
          const FLUSH_INTERVAL = 10; // 10ms

          const flushTokenBuffer = () => {
            if (tokenBuffer) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "token", content: tokenBuffer })}\n\n`,
                ),
              );
              tokenBuffer = "";
              lastFlushTime = Date.now();
            }
          };

          // Use single-agent service (original behavior)
          for await (const event of agentService.streamAgent({
            messages,
            modelId: model,
            systemPrompt: effectiveSystemPrompt,
            mcpServers,
            allowedTools,
            customTools: customToolsForAgent,
            images: imagesForAI,
            modelOptions: {
              temperature: effectiveTemperature,
              topP: effectiveTopP,
            },
            userContext: {
              userId: user.id,
              name: user.name,
              email: user.email,
              timezone: req.headers.get("x-timezone") || "Asia/Kolkata",
            },
          })) {
            if (event.type !== "token") {
              flushTokenBuffer();
            }
            switch (event.type) {
              case "token":
                if (event.content) {
                  fullResponse += event.content;
                  tokenBuffer += event.content;
                  if (Date.now() - lastFlushTime >= FLUSH_INTERVAL) {
                    flushTokenBuffer();
                  }
                }
                break;

              case "tool_call_start":
                const sourceToolCallId = event.toolCallId || generateId();
                const toolCallId =
                  sourceToUiToolCallId.get(sourceToolCallId) || generateId();
                sourceToUiToolCallId.set(sourceToolCallId, toolCallId);
                pendingToolCallIds.push(toolCallId);

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_start",
                      toolCall: {
                        id: toolCallId,
                        name: event.toolName,
                        arguments: event.toolArgs || {},
                      },
                    })}\n\n`,
                  ),
                );
                toolCalls.push({
                  id: toolCallId,
                  name: event.toolName || "",
                  arguments: event.toolArgs || {},
                });
                break;

              case "tool_call_end":
                break;

              case "citations":
                citations = event.citations || [];
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "citations",
                      citations: event.citations,
                    })}\n\n`,
                  ),
                );
                break;

              case "tool_result":
                let resolvedToolCallId: string | undefined;
                if (event.toolCallId) {
                  resolvedToolCallId = sourceToUiToolCallId.get(
                    event.toolCallId,
                  );
                }
                if (!resolvedToolCallId) {
                  resolvedToolCallId = pendingToolCallIds[0];
                }

                if (!resolvedToolCallId) {
                  resolvedToolCallId = generateId();
                  toolCalls.push({
                    id: resolvedToolCallId,
                    name: event.toolName || "unknown_tool",
                    arguments: {},
                  });
                }

                const pendingIndex =
                  pendingToolCallIds.indexOf(resolvedToolCallId);
                if (pendingIndex !== -1) {
                  pendingToolCallIds.splice(pendingIndex, 1);
                }

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      toolCallId: resolvedToolCallId,
                      result: event.toolResult,
                    })}\n\n`,
                  ),
                );
                const matchedToolCall = toolCalls.find(
                  (tc) => tc.id === resolvedToolCallId,
                );
                if (matchedToolCall) {
                  matchedToolCall.result = event.toolResult;
                  try {
                    const parsed = JSON.parse(event.toolResult ?? "");
                    if (parsed._tokens) {
                      matchedToolCall.tokens = parsed._tokens;
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
                break;

              case "token_usage":
                tokenUsage.prompt += event.promptTokens ?? 0;
                tokenUsage.completion += event.completionTokens ?? 0;
                tokenUsage.total += event.totalTokens ?? 0;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "token_usage",
                      promptTokens: event.promptTokens,
                      completionTokens: event.completionTokens,
                      totalTokens: event.totalTokens,
                    })}\n\n`,
                  ),
                );
                break;

              case "error":
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "error", error: event.error })}\n\n`,
                  ),
                );
                break;
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
          if (tokenUsage.total === 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "token_usage",
                  promptTokens: fallbackPrompt,
                  completionTokens: fallbackCompletion,
                  totalTokens: fallbackPrompt + fallbackCompletion,
                })}\n\n`,
              ),
            );
          }

          // Save assistant message with tool calls
          const assistantPayload = {
            versionId: pairedAssistantVersionId,
            content: fullResponse,
            model,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens:
              tokenUsage.total > 0
                ? {
                    prompt: tokenUsage.prompt,
                    completion: tokenUsage.completion,
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

          // Send the saved message ID so frontend can update for feedback
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "message_saved", messageId: savedMessage.id })}\n\n`,
            ),
          );

          // Generate title for first message in thread
          await StreamPipeline.generateTitleIfNeeded(
            currentThreadId,
            isFirstMessage,
            encoder,
            controller,
          );

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          controller.close();
        } catch (error) {
          logger.error({ err: error }, "Agent streaming error");
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: "An error occurred" })}\n\n`,
            ),
          );
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
    logger.error({ err: error }, "Agent stream error");
    return handleError(error, "Agent stream");
  }
}
