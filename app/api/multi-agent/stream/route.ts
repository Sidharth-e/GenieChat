import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { multiAgentService } from "@/lib/langchain/multi-agent-service";
import { store } from "@/lib/store";
import { MCPServerConfig, Agent, ToolSecret } from "@/lib/types";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { convertCustomToolToLangChain } from "@/lib/tool/custom-tool-converter";
import { handleError, api } from "@/lib/api-utils";
import { StreamPipeline } from "@/lib/api/stream-pipeline";
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
      namespace: "multi_agent_stream",
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
    } = await StreamPipeline.prepareStreamContext(
      req,
      true,
      "[Multi-Agent API]",
    );

    const { model, agentId, systemPrompt, temperature, topP } = requestBody;
    const userId = user.id;

    logger.info("Multi-Agent messages for processing:", messages.length);

    // Get agent configuration and relevant MCP servers
    let allowedTools: string[] | undefined;
    let mcpServers: MCPServerConfig[] = [];
    let currentAgent: Agent | null = null;
    const customToolsLookup = new Map<string, StructuredToolInterface>();
    const fullSubAgents: {
      id: string;
      name: string;
      systemPrompt?: string;
      modelId?: string;
      temperature?: number;
      topP?: number;
      allowedTools?: string[];
    }[] = [];

    let effectiveSystemPrompt: string = systemPrompt ?? "";
    let effectiveTemperature: number | undefined = temperature;
    let effectiveTopP: number | undefined = topP;

    if (agentStore && mcpStore) {
      try {
        // Single round: secrets, agent config, tools, and MCP servers are all independent
        const secretStore = new SecretStore();
        const toolStore = new ToolStore();
        type ToolList = Awaited<ReturnType<typeof toolStore.getTools>>;
        const [userSecrets, fetchedAgent, userCustomTools, allServers] = await Promise.all([
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

          effectiveTemperature ??= currentAgent.temperature;
          effectiveTopP ??= currentAgent.topP;

          const identityPrompt = `\n\nSYSTEM INFO:\nYou are an AI agent named "${currentAgent.name}".\nYour Agent ID is "${currentAgent.id}".\nIf you need to search your knowledge base using the 'knowledge_base_search' tool, you SHOULD provide this Agent ID to filter results specific to you.`;

          effectiveSystemPrompt = (effectiveSystemPrompt || "") + identityPrompt;
          currentAgent.systemPrompt = (currentAgent.systemPrompt || "") + identityPrompt;

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

        // Sub-agents need agent config to know which ones to fetch — second round, parallel
        if (currentAgent?.subAgents?.length) {
          logger.info(`Fetching details for ${currentAgent.subAgents.length} sub-agents`);
          const subAgentResults = await Promise.all(
            currentAgent.subAgents.map((sub) =>
              agentStore.getAgent(sub.id).catch((err) => {
                logger.warn(`Failed to fetch sub-agent ${sub.name} (${sub.id})`, err);
                return null;
              }),
            ),
          );
          for (const paramsAgent of subAgentResults) {
            if (paramsAgent) {
              fullSubAgents.push({
                id: paramsAgent.id,
                name: paramsAgent.name,
                systemPrompt: paramsAgent.systemPrompt,
                modelId: paramsAgent.modelId,
                temperature: paramsAgent.temperature,
                topP: paramsAgent.topP,
                allowedTools: paramsAgent.tools,
              });
            }
          }
        }
        logger.info(`Allowed tools: ${allowedTools?.join(", ")}`);

        try {
          for (const customTool of (userCustomTools as ToolList).filter(
            (tool) => tool.enabled,
          )) {
            const structuredTool = convertCustomToolToLangChain(
              customTool,
              secretMap,
            );
            const aliases = [
              `custom:${customTool.id}`,
              `custom:${customTool.name}`,
              customTool.id,
              customTool.name,
              toSnakeCase(customTool.name),
              structuredTool.name,
            ];
            aliases.forEach((alias) =>
              customToolsLookup.set(alias, structuredTool),
            );
          }

          if (customToolsLookup.size > 0) {
            logger.info(`Loaded ${customToolsLookup.size} custom tool aliases`);
          }
        } catch (err) {
          logger.warn("Failed to load custom tools for multi-agent:", err);
        }

        logger.info(`All servers: ${allServers.map((s) => s.name).join(", ")}`);
        const enabledServers = allServers.filter(
          (s: MCPServerConfig) => s.enabled,
        );
        logger.info(
          `Enabled servers: ${enabledServers.map((s) => s.name).join(", ")}`,
        );

        // 4. Filter servers based on ALL required tools (main agent + sub-agents)
        const allRequiredTools = new Set<string>(allowedTools || []);
        fullSubAgents.forEach((sa) =>
          sa.allowedTools?.forEach((t) => allRequiredTools.add(t)),
        );
        const allRequiredToolsList = Array.from(allRequiredTools);

        if (allRequiredToolsList.length > 0) {
          const allowedServerNames = new Set(
            allRequiredToolsList
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
        } else {
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
      customToolsLookup.set("use_skill", useSkillTool);
    }

    const subAgentByKey = new Map<string, { id: string; name: string }>();
    const handoffToolTargets = new Map<string, { id: string; name: string }>();
    for (const subAgent of fullSubAgents) {
      const normalizedName = toSnakeCase(subAgent.name);
      const target = { id: subAgent.id, name: subAgent.name };

      subAgentByKey.set(subAgent.id, target);
      subAgentByKey.set(normalizedName, target);
      handoffToolTargets.set(`ask_${normalizedName}`, target);
      handoffToolTargets.set(`transfer_to_${normalizedName}`, target);
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Track active tool calls with stable event IDs first, then fallback to legacy key matching.
          const activeToolCallsByEventId = new Map<string, string>();
          const activeToolCallsByLegacyKey = new Map<string, string>();
          const activeHandoffToolBySubAgentKey = new Map<string, string>();

          interface SubAgentMessageData {
            content: string;
            agentId: string;
            agentName: string;
            toolCalls?: AgentToolCall[];
          }
          interface AgentToolCall {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
            result?: string;
            tokens?: { prompt: number; completion: number };
            agentId?: string;
            agentName?: string;
            subAgentMessage?: SubAgentMessageData;
          }
          interface SupervisorMessageState {
            content: string;
            toolCalls: AgentToolCall[];
            citations: string[];
          }

          const supervisorState: SupervisorMessageState = {
            content: "",
            toolCalls: [],
            citations: [],
          };

          const resolveKnownSubAgent = (
            agentId: string | undefined,
            agentName: string | undefined,
          ) => {
            if (agentId) {
              const byId = subAgentByKey.get(agentId);
              if (byId) {
                return byId;
              }
            }

            if (!agentName) {
              return undefined;
            }

            return subAgentByKey.get(toSnakeCase(agentName));
          };

          const setActiveHandoffTool = (
            subAgent: { id: string; name: string },
            parentToolCallId: string,
          ) => {
            activeHandoffToolBySubAgentKey.set(subAgent.id, parentToolCallId);
            activeHandoffToolBySubAgentKey.set(
              toSnakeCase(subAgent.name),
              parentToolCallId,
            );
          };

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

          let currentBufferedAgent: {
            agentId?: string;
            agentName?: string;
            parentToolCallId?: string;
          } | null = null;

          const flushTokenBuffer = () => {
            if (tokenBuffer && currentBufferedAgent) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "token",
                    content: tokenBuffer,
                    agentId: currentBufferedAgent.agentId,
                    agentName: currentBufferedAgent.agentName,
                    parentToolCallId: currentBufferedAgent.parentToolCallId,
                  })}\n\n`,
                ),
              );
              tokenBuffer = "";
              lastFlushTime = Date.now();
            }
          };

          const writeEvent = (data: unknown) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          };

          const tokenUsage = { prompt: 0, completion: 0, total: 0 };

          for await (const event of multiAgentService.streamAgent({
            messages,
            modelId: model,
            systemPrompt: effectiveSystemPrompt,
            mcpServers,
            images: imagesForAI,
            modelOptions: {
              temperature: effectiveTemperature,
              topP: effectiveTopP,
            },
            userContext: {
              name: user.name,
              email: user.email,
              timezone: req.headers.get("x-timezone") || "Asia/Kolkata",
            },
            customToolsLookup,
            subAgents: fullSubAgents,
          })) {
            if (event.type !== "token") {
              flushTokenBuffer();
            }
            switch (event.type) {
              case "token":
                if (event.content) {
                  const knownSubAgent = resolveKnownSubAgent(
                    event.agentId,
                    event.agentName,
                  );

                  const targetAgentId = event.agentId;
                  let targetParentToolCallId: string | undefined;

                  if (knownSubAgent) {
                    break;
                  }

                  supervisorState.content += event.content;

                  if (
                    currentBufferedAgent &&
                    (currentBufferedAgent.agentId !== targetAgentId ||
                      currentBufferedAgent.parentToolCallId !==
                        targetParentToolCallId)
                  ) {
                    flushTokenBuffer();
                  }

                  // Don't forward the raw LangGraph node name — the client resolves
                  // the supervisor's display name from its own agent prop.
                  currentBufferedAgent = {
                    agentId: targetAgentId,
                    agentName: undefined,
                    parentToolCallId: targetParentToolCallId,
                  };

                  tokenBuffer += event.content;
                  if (Date.now() - lastFlushTime >= FLUSH_INTERVAL) {
                    flushTokenBuffer();
                  }
                }
                break;

              case "tool_call_start": {
                const toolCallId = event.toolCallId || generateId();
                const toolName = event.toolName || "unknown_tool";
                const knownSubAgent = resolveKnownSubAgent(
                  event.agentId,
                  event.agentName,
                );

                if (event.toolCallId) {
                  activeToolCallsByEventId.set(event.toolCallId, toolCallId);
                }

                const toolKey = `${toolName}:${knownSubAgent?.id || event.agentId || "supervisor"}`;
                activeToolCallsByLegacyKey.set(toolKey, toolCallId);

                const nextToolCall: AgentToolCall = {
                  id: toolCallId,
                  name: toolName,
                  arguments: event.toolArgs || {},
                  agentId: knownSubAgent?.id || event.agentId,
                  agentName: knownSubAgent?.name || event.agentName,
                };

                if (knownSubAgent) {
                  break;
                }

                supervisorState.toolCalls.push(nextToolCall);

                const handoffTarget = handoffToolTargets.get(toolName);
                if (handoffTarget) {
                  setActiveHandoffTool(handoffTarget, toolCallId);
                }

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_start",
                      toolCall: nextToolCall,
                      agentId: event.agentId,
                      agentName: event.agentName,
                    })}\n\n`,
                  ),
                );
                break;
              }

              case "tool_call_end":
                break;

              case "citations":
                supervisorState.citations = event.citations || [];
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "citations",
                      citations: event.citations,
                    })}\n\n`,
                  ),
                );
                break;

              case "tool_result": {
                let matchedToolCallId: string | undefined;
                const knownSubAgent = resolveKnownSubAgent(
                  event.agentId,
                  event.agentName,
                );

                if (event.toolCallId) {
                  matchedToolCallId =
                    activeToolCallsByEventId.get(event.toolCallId) ||
                    event.toolCallId;
                  activeToolCallsByEventId.delete(event.toolCallId);
                }

                if (!matchedToolCallId) {
                  const resultToolName = event.toolName || "unknown_tool";
                  const resultToolKey = `${resultToolName}:${knownSubAgent?.id || event.agentId || "supervisor"}`;
                  matchedToolCallId =
                    activeToolCallsByLegacyKey.get(resultToolKey);
                  if (matchedToolCallId) {
                    activeToolCallsByLegacyKey.delete(resultToolKey);
                  }
                } else {
                  for (const [legacyKey, id] of activeToolCallsByLegacyKey) {
                    if (id === matchedToolCallId) {
                      activeToolCallsByLegacyKey.delete(legacyKey);
                      break;
                    }
                  }
                }

                if (knownSubAgent) {
                  break;
                }

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      toolCallId: matchedToolCallId,
                      result: event.toolResult,
                      agentId: event.agentId,
                      agentName: event.agentName,
                    })}\n\n`,
                  ),
                );
                if (matchedToolCallId) {
                  const matchedToolCall = supervisorState.toolCalls.find(
                    (tc) => tc.id === matchedToolCallId,
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
                }
                break;
              }

              case "token_usage":
                if (
                  event.promptTokens !== undefined &&
                  event.completionTokens !== undefined &&
                  event.totalTokens !== undefined
                ) {
                  tokenUsage.prompt += event.promptTokens;
                  tokenUsage.completion += event.completionTokens;
                  tokenUsage.total += event.totalTokens;
                  writeEvent({
                    type: "token_usage",
                    promptTokens: event.promptTokens,
                    completionTokens: event.completionTokens,
                    totalTokens: event.totalTokens,
                  });
                }
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

          const assistantPayload = {
            versionId: pairedAssistantVersionId,
            content: supervisorState.content,
            model,
            toolCalls:
              supervisorState.toolCalls.length > 0
                ? supervisorState.toolCalls
                : undefined,
            tokens:
              tokenUsage.total > 0
                ? {
                    prompt: tokenUsage.prompt,
                    completion: tokenUsage.completion,
                  }
                : undefined,
            citations:
              supervisorState.citations.length > 0
                ? supervisorState.citations
                : undefined,
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

          // Send the saved message ID
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "message_saved",
                messageId: savedMessage.id,
              })}\n\n`,
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
    return handleError(error, "Multi-agent stream");
  }
}
