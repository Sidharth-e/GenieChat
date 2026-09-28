import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { agentService } from "@/lib/langchain/agent-service";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { ToolStore } from "@/lib/mongodb/tool-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { authenticateApiKey, hasAgentAccess } from "@/lib/api/agent-api-auth";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { convertCustomToolToLangChain } from "@/lib/tool/custom-tool-converter";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { MCPServerConfig, ToolSecret, Message } from "@/lib/types";
import { StructuredToolInterface } from "@langchain/core/tools";
import { generateId } from "@/lib/utils";
import {
  ResponsesApiRequest,
  responsesInputToInternal,
  buildResponsesApiResponse,
} from "@/lib/api/openai-compat";
import { store } from "@/lib/store";

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

function extractLastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    }
  }
  return "";
}

async function saveApiCallHistory(
  userId: string,
  userName: string,
  userEmail: string,
  agentId: string,
  modelId: string,
  userText: string,
  assistantContent: string,
): Promise<void> {
  try {
    const thread = await store.createThread(
      userId,
      modelId,
      agentId,
      false,
      "agent-api",
      undefined,
      userName,
      userEmail,
    );
    if (userText) {
      await store.addMessage(thread.id, {
        threadId: thread.id,
        userId,
        userName,
        userEmail,
        role: "user",
        content: userText,
      });
    }
    await store.addMessage(thread.id, {
      threadId: thread.id,
      userId,
      userName,
      userEmail,
      role: "assistant",
      content: assistantContent,
      model: modelId,
    });
  } catch (err) {
    logger.warn({ err }, "[AgentsAPI] Failed to save API call history");
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limit
    const rateLimit = await checkRateLimit(req, {
      namespace: "agents_api_responses",
      ...config.rateLimit.standard,
    });

    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        "Rate limit exceeded. Please try again later.",
        rateLimit.retryAfterSeconds,
      );
    }

    // 2. Authenticate via API key
    const authResult = await authenticateApiKey(req);
    if (!authResult.authenticated || !authResult.apiKey) {
      return api.unauthorized(authResult.error || "Unauthorized");
    }

    const { apiKey } = authResult;

    // 3. Parse body and validate
    let body: ResponsesApiRequest;
    try {
      body = (await req.json()) as ResponsesApiRequest;
    } catch {
      return api.badRequest("Invalid JSON body");
    }

    const { model: agentId, input, stream, temperature, top_p } = body;

    if (!agentId) {
      return api.badRequest("Missing required field: model (agent ID)");
    }

    if (!input || (Array.isArray(input) && input.length === 0)) {
      return api.badRequest("Missing or empty required field: input");
    }

    // 4. Check agent access
    if (!hasAgentAccess(apiKey, agentId)) {
      return api.forbidden("API key does not have access to this agent");
    }

    // 5. Load agent
    if (!agentStore || !mcpStore) {
      return api.serviceUnavailable("Agent service is not configured");
    }

    const agent = await agentStore.getAgent(agentId);
    if (!agent) {
      return api.notFound("Agent");
    }

    // 6. Convert input
    const { systemPrompt: clientSystemPrompt, internalMessages } =
      responsesInputToInternal(input, apiKey.userId);

    // 7. Build effective system prompt
    const identityPrompt = `\n\nSYSTEM INFO:\nYou are an AI agent named "${agent.name}".\nYour Agent ID is "${agent.id}".\nIf you need to search your knowledge base using the 'knowledge_base_search' tool, you SHOULD provide this Agent ID to filter results specific to you.`;

    const effectiveSystemPrompt =
      (agent.systemPrompt || "") +
      (clientSystemPrompt ? "\n" + clientSystemPrompt : "") +
      identityPrompt;

    // 8. Load tools (MCP servers + custom tools)
    let mcpServers: MCPServerConfig[] = [];
    let customToolsForAgent: StructuredToolInterface[] = [];

    try {
      let userSecrets: ToolSecret[] = [];
      if (isDatabaseConfigured()) {
        const secretStore = new SecretStore();
        userSecrets = await secretStore.getSecrets(apiKey.userId);
      }

      const secretMap = userSecrets.reduce(
        (acc, secret) => {
          acc[secret.name] = secret.value;
          return acc;
        },
        {} as Record<string, string>,
      );

      // Load custom tools matching agent's allowed tools
      if (agent.tools && agent.tools.length > 0) {
        try {
          const toolStore = new ToolStore();
          const userCustomTools = await toolStore.getTools(apiKey.userId);

          const allowedSet = new Set(agent.tools);
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
              `[AgentsAPI] Loaded ${customToolsForAgent.length} custom tools for agent`,
            );
          }
        } catch (err) {
          logger.warn("[AgentsAPI] Failed to load custom tools for agent:", err);
        }
      }

      // Load MCP servers, filter by allowed tool server names
      const allServers = await mcpStore.getMCPServers(apiKey.userId);
      const enabledServers = allServers.filter(
        (s: MCPServerConfig) => s.enabled,
      );

      if (agent.tools && agent.tools.length > 0) {
        const allowedServerNames = new Set(
          agent.tools
            .map((t) => {
              const parts = t.split(":");
              return parts.length > 1 ? parts[0] : null;
            })
            .filter(Boolean),
        );

        if (allowedServerNames.size > 0) {
          mcpServers = enabledServers.filter((s) =>
            allowedServerNames.has(s.name),
          );
        } else {
          mcpServers = enabledServers;
        }
      } else if (agent.tools && agent.tools.length === 0) {
        mcpServers = [];
      }

      mcpServers = resolveMCPServerSecrets(mcpServers, secretMap);
    } catch (err) {
      logger.warn(
        "[AgentsAPI] Error fetching agent settings or MCP servers:",
        err,
      );
    }

    // 9. Generate response ID
    const responseId = `resp-${generateId()}`;

    // Build common params for agentService.streamAgent
    const streamParams = {
      messages: internalMessages,
      modelId: agent.modelId || "gemini-3-flash-preview",
      systemPrompt: effectiveSystemPrompt,
      mcpServers,
      allowedTools: agent.tools,
      customTools: customToolsForAgent,
      modelOptions: {
        temperature: temperature ?? agent.temperature,
        topP: top_p ?? agent.topP,
      },
      userContext: {
        userId: apiKey.userId,
        name: apiKey.userName,
        email: apiKey.userEmail,
      },
    };

    // Streaming response
    if (stream) {
      let savedContent = "";
      const userText = extractLastUserText(internalMessages);
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            // Send response.created event
            const createdEvent = {
              type: "response.created",
              response: {
                id: responseId,
                object: "response",
                model: agentId,
              },
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(createdEvent)}\n\n`),
            );

            // Stream agent events
            for await (const event of agentService.streamAgent(streamParams)) {
              switch (event.type) {
                case "token":
                  if (event.content) {
                    const deltaEvent = {
                      type: "response.output_text.delta",
                      delta: event.content,
                    };
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify(deltaEvent)}\n\n`,
                      ),
                    );
                    savedContent += event.content;
                  }
                  break;

                case "error":
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "error",
                        error: {
                          message: event.error || "An error occurred",
                          type: "server_error",
                        },
                      })}\n\n`,
                    ),
                  );
                  break;

                // tool_call_start, tool_call_end, tool_result, citations, done
                // are internal events — not part of Responses API SSE protocol
                default:
                  break;
              }
            }

            await saveApiCallHistory(
              apiKey.userId,
              apiKey.userName,
              apiKey.userEmail,
              agentId,
              agent.modelId || "gemini-3-flash-preview",
              userText,
              savedContent,
            );

            // Send output_text.done event
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "response.output_text.done" })}\n\n`,
              ),
            );

            // Send response.completed event
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "response.completed" })}\n\n`,
              ),
            );

            controller.close();
          } catch (error) {
            logger.error({ err: error }, "[AgentsAPI] Streaming error");
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "error",
                    error: {
                      message: "An error occurred during streaming",
                      type: "server_error",
                    },
                  })}\n\n`,
                ),
              );
            } catch {
              // Controller may already be closed
            }
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming response
    let fullContent = "";
    for await (const event of agentService.streamAgent(streamParams)) {
      switch (event.type) {
        case "token":
          if (event.content) {
            fullContent += event.content;
          }
          break;

        case "error":
          logger.error("[AgentsAPI] Agent error event:", event.error);
          return api.error(event.error || "Agent processing error", 500);

        default:
          break;
      }
    }

    const userText = extractLastUserText(internalMessages);
    await saveApiCallHistory(
      apiKey.userId,
      apiKey.userName,
      apiKey.userEmail,
      agentId,
      agent.modelId || "gemini-3-flash-preview",
      userText,
      fullContent,
    );

    return api.success(
      buildResponsesApiResponse(fullContent, agentId, responseId),
    );
  } catch (error) {
    logger.error({ err: error }, "[AgentsAPI] Responses API error");
    return handleError(error, "Responses API");
  }
}
