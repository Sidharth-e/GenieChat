import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { swarmAgentService, SwarmAgentConfig } from "@/lib/langchain/swarm-agent-service";
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
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { storageRefSchema } from "@/lib/storage/ref";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-session-user";
import {
  hydrateMessages,
  processDocuments,
  processImages,
  getHistoricalImages,
} from "@/lib/api/stream-helper";
import { saveToolArtifact } from "@/lib/artifacts/save";

export const runtime = "nodejs";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const swarmRequestSchema = z.object({
  threadId: z.string().min(1).max(128).optional(),
  message: z.string().min(1),
  model: z.string().min(1).max(120),
  swarmAgentIds: z.array(z.string().min(1).max(128)).min(2).max(8),
  maxRounds: z.number().min(1).max(20).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  documents: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        fileName: z.string().min(1).max(260),
        ref: storageRefSchema,
        mimeType: z.string().min(1).max(255).optional(),
      }),
    )
    .max(10)
    .optional(),
  images: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        fileName: z.string().min(1).max(260),
        ref: storageRefSchema,
        mimeType: z.string().min(1).max(255),
      }),
    )
    .max(8)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(req, {
      namespace: "swarm_stream",
      ...config.rateLimit.streaming,
    });

    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        "Rate limit exceeded. Please try again later.",
        rateLimit.retryAfterSeconds,
      );
    }

    const user = await getSessionUser();
    if (!user) {
      return api.unauthorized("Unauthorized");
    }

    const parsed = swarmRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message || "Invalid request";
      return api.badRequest(firstError);
    }

    const body = parsed.data;
    const userId = user.id;

    // Initialize thread
    const { threadId: currentThreadId, isNewThread } =
      await StreamPipeline.initializeThread(
        userId,
        user.name,
        user.email,
        { ...body, model: body.model } as Parameters<typeof StreamPipeline.initializeThread>[3],
        false,
        { isSwarm: true, swarmAgentIds: body.swarmAgentIds },
      );

    // Get existing messages & process assets
    const existingMessages = await store.getMessages(currentThreadId);
    const isFirstMessage = existingMessages.length === 0;

    const documents = body.documents ?? [];
    const images = body.images ?? [];
    const processedDocuments = await processDocuments(documents, userId, "[Swarm API]");
    const { processedImages, imagesForAI: newImagesForAI } = await processImages(images, userId, "[Swarm API]");
    const historicalImages = await getHistoricalImages(existingMessages, userId, "[Swarm API]");
    const imagesForAI = [...newImagesForAI, ...historicalImages];

    // Save user message
    const savedUserMessage = await store.addMessage(currentThreadId, {
      threadId: currentThreadId,
      userId,
      userName: user.name,
      userEmail: user.email,
      role: "user",
      content: body.message,
      model: body.model,
      documents: processedDocuments.length > 0 ? processedDocuments : undefined,
      images: processedImages.length > 0 ? processedImages : undefined,
    });

    const rawMessages = [...existingMessages, savedUserMessage];
    const messages = await hydrateMessages(rawMessages, userId, "[Swarm API]");

    // Fetch agent configs
    if (!agentStore) {
      return api.badRequest("Agent store not configured");
    }

    const agentResults = await Promise.all(
      body.swarmAgentIds.map((id) =>
        agentStore.getAgent(id).catch((err) => {
          logger.warn(`Failed to fetch swarm agent ${id}`, err);
          return null;
        }),
      ),
    );

    const validAgents = agentResults.filter((a): a is Agent => a !== null);
    if (validAgents.length < 2) {
      return api.badRequest("At least 2 valid agents are required for swarm mode");
    }

    // Resolve MCP servers, custom tools, and secrets
    let mcpServers: MCPServerConfig[] = [];
    const customToolsLookup = new Map<string, StructuredToolInterface>();

    if (mcpStore) {
      try {
        const secretStore = new SecretStore();
        const toolStore = new ToolStore();

        const [userSecrets, userCustomTools, allServers] = await Promise.all([
          isDatabaseConfigured()
            ? secretStore.getSecrets(userId)
            : Promise.resolve([] as ToolSecret[]),
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

        for (const customTool of userCustomTools.filter((t) => t.enabled)) {
          const structuredTool = convertCustomToolToLangChain(customTool, secretMap);
          const aliases = [
            `custom:${customTool.id}`,
            `custom:${customTool.name}`,
            customTool.id,
            customTool.name,
            toSnakeCase(customTool.name),
            structuredTool.name,
          ];
          aliases.forEach((alias) => customToolsLookup.set(alias, structuredTool));
        }

        // Collect all required tools across agents
        const allRequiredTools = new Set<string>();
        validAgents.forEach((a) => a.tools?.forEach((t) => allRequiredTools.add(t)));

        const enabledServers = allServers.filter((s: MCPServerConfig) => s.enabled);
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

          mcpServers =
            allowedServerNames.size > 0
              ? enabledServers.filter((s) => allowedServerNames.has(s.name))
              : enabledServers;
        }

        mcpServers = resolveMCPServerSecrets(mcpServers, secretMap);
      } catch (err) {
        logger.warn("Error fetching swarm agent settings:", err);
      }
    }

    // Build swarm agent configs
    const swarmAgentConfigs: SwarmAgentConfig[] = validAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      systemPrompt: a.systemPrompt,
      modelId: a.modelId,
      temperature: a.temperature,
      topP: a.topP,
      allowedTools: a.tools,
    }));

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isNewThread) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "thread", threadId: currentThreadId })}\n\n`,
              ),
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "user_message_saved", messageId: savedUserMessage.id })}\n\n`,
            ),
          );

          let tokenBuffer = "";
          let tokenBufferAgentId: string | undefined;
          let tokenBufferAgentName: string | undefined;
          let lastFlushTime = Date.now();
          const FLUSH_INTERVAL = 10;

          const agentContentMap = new Map<string, string>();
          const agentToolCallsMap = new Map<string, {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
            result?: string;
            agentId?: string;
            agentName?: string;
          }[]>();
          const activeToolCallsByEventId = new Map<string, string>();
          const agentTokensMap = new Map<string, { prompt: number; completion: number }>();

          const flushTokenBuffer = () => {
            if (tokenBuffer && tokenBufferAgentId) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "token",
                    content: tokenBuffer,
                    agentId: tokenBufferAgentId,
                    agentName: tokenBufferAgentName,
                  })}\n\n`,
                ),
              );
              tokenBuffer = "";
              lastFlushTime = Date.now();
            }
          };

          for await (const event of swarmAgentService.streamSwarm({
            messages,
            agents: swarmAgentConfigs,
            defaultModelId: body.model,
            mcpServers,
            images: imagesForAI,
            modelOptions: {
              temperature: body.temperature,
              topP: body.topP,
            },
            userContext: {
              name: user.name,
              email: user.email,
              timezone: req.headers.get("x-timezone") || "Asia/Kolkata",
            },
            customToolsLookup,
            maxRounds: body.maxRounds,
          })) {
            if (event.type !== "token") {
              flushTokenBuffer();
            }

            const writeEvent = (data: unknown) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              );
            };

            switch (event.type) {
              case "agent_turn_start":
                if (event.agentId) {
                  agentContentMap.set(event.agentId, "");
                  agentToolCallsMap.set(event.agentId, []);
                }

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "agent_turn_start",
                      agentId: event.agentId,
                      agentName: event.agentName,
                    })}\n\n`,
                  ),
                );
                break;

              case "token":
                if (event.content && event.agentId) {
                  agentContentMap.set(
                    event.agentId,
                    (agentContentMap.get(event.agentId) || "") + event.content,
                  );
                  if (tokenBufferAgentId && tokenBufferAgentId !== event.agentId) {
                    flushTokenBuffer();
                  }
                  tokenBufferAgentId = event.agentId;
                  tokenBufferAgentName = event.agentName;
                  tokenBuffer += event.content;
                  if (Date.now() - lastFlushTime >= FLUSH_INTERVAL) {
                    flushTokenBuffer();
                  }
                }
                break;

              case "tool_call_start": {
                const toolCallId = event.toolCallId || generateId();
                if (event.toolCallId) {
                  activeToolCallsByEventId.set(event.toolCallId, toolCallId);
                }

                const toolCall = {
                  id: toolCallId,
                  name: event.toolName || "unknown_tool",
                  arguments: event.toolArgs || {},
                  agentId: event.agentId,
                  agentName: event.agentName,
                };
                if (event.agentId) {
                  const calls = agentToolCallsMap.get(event.agentId) || [];
                  calls.push(toolCall);
                  agentToolCallsMap.set(event.agentId, calls);
                }

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_start",
                      toolCall,
                      agentId: event.agentId,
                      agentName: event.agentName,
                    })}\n\n`,
                  ),
                );
                break;
              }

              case "tool_result": {
                let matchedToolCallId: string | undefined;
                if (event.toolCallId) {
                  matchedToolCallId =
                    activeToolCallsByEventId.get(event.toolCallId) || event.toolCallId;
                  activeToolCallsByEventId.delete(event.toolCallId);
                }

                if (event.agentId) {
                  const calls = agentToolCallsMap.get(event.agentId) || [];
                  const matchedToolCall = calls.find((tc) => tc.id === matchedToolCallId);
                  if (matchedToolCall) {
                    matchedToolCall.result = event.toolResult;
                  }
                }

                try {
                  const parsed = JSON.parse(event.toolResult ?? "");
                  if (parsed._artifact) {
                    saveToolArtifact(userId, parsed._artifact, currentThreadId).catch(() => {});
                  }
                  if (parsed._artifacts) {
                    for (const a of parsed._artifacts) {
                      saveToolArtifact(userId, a, currentThreadId).catch(() => {});
                    }
                  }
                } catch {
                  // result is not JSON
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
                break;
              }

              case "token_usage":
                if (
                  event.promptTokens !== undefined &&
                  event.completionTokens !== undefined &&
                  event.totalTokens !== undefined
                ) {
                  if (event.agentId) {
                    const prev = agentTokensMap.get(event.agentId) || {
                      prompt: 0,
                      completion: 0,
                    };
                    agentTokensMap.set(event.agentId, {
                      prompt: prev.prompt + event.promptTokens,
                      completion: prev.completion + event.completionTokens,
                    });
                  }
                  writeEvent({
                    type: "token_usage",
                    promptTokens: event.promptTokens,
                    completionTokens: event.completionTokens,
                    totalTokens: event.totalTokens,
                  });
                }
                break;

              case "agent_turn_end": {
                const agentId = event.agentId!;
                const endContent = agentContentMap.get(agentId) || "";
                const endToolCalls = agentToolCallsMap.get(agentId) || [];
                const turnTokens = agentTokensMap.get(agentId);
                agentContentMap.delete(agentId);
                agentToolCallsMap.delete(agentId);
                agentTokensMap.delete(agentId);

                const promptTokens =
                  turnTokens && turnTokens.prompt > 0
                    ? turnTokens.prompt
                    : Math.max(1, Math.ceil((body.message?.length || 0) / 4));
                const completionTokens =
                  turnTokens && turnTokens.completion > 0
                    ? turnTokens.completion
                    : Math.max(1, Math.ceil(endContent.length / 4));

                const savedMsg = await store.addMessage(currentThreadId, {
                  threadId: currentThreadId,
                  userId,
                  userName: user.name,
                  userEmail: user.email,
                  role: "assistant",
                  content: endContent,
                  model: swarmAgentConfigs.find((a) => a.id === agentId)?.modelId || body.model,
                  agentId: event.agentId,
                  agentName: event.agentName,
                  toolCalls:
                    endToolCalls.length > 0
                      ? endToolCalls.map((tc) => ({ ...tc }))
                      : undefined,
                  tokens: {
                    prompt: promptTokens,
                    completion: completionTokens,
                  },
                });

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "agent_turn_end",
                      agentId: event.agentId,
                      agentName: event.agentName,
                      messageId: savedMsg.id,
                    })}\n\n`,
                  ),
                );
                break;
              }

              case "error":
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "error",
                      error: event.error,
                      agentId: event.agentId,
                      agentName: event.agentName,
                    })}\n\n`,
                  ),
                );
                break;

              case "routing":
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "routing",
                      round: event.round,
                      routedAgents: event.routedAgents,
                      routingReason: event.routingReason,
                    })}\n\n`,
                  ),
                );
                break;

              case "round_start":
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "round_start",
                      round: event.round,
                    })}\n\n`,
                  ),
                );
                break;

              case "round_end":
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "round_end",
                      round: event.round,
                    })}\n\n`,
                  ),
                );
                break;
            }
          }

          flushTokenBuffer();

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
          logger.error({ err: error }, "Swarm streaming error");
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
    logger.error({ err: error }, "Swarm stream error");
    return handleError(error, "Swarm stream");
  }
}
