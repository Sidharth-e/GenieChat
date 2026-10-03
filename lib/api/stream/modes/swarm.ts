import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import {
  swarmAgentService,
  type SwarmAgentConfig,
} from "@/lib/langchain/swarm-agent-service";
import { store } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { handleError, api } from "@/lib/api-utils";
import { StreamPipeline } from "@/lib/api/stream-pipeline";
import { generateId } from "@/lib/utils";
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
import { loadUserTooling, filterConnectors } from "../context";
import type { PersistedToolCall, ProducerEvent } from "../events";
import {
  runTokenStream,
  type StreamRunContext,
} from "../runner";
import { createAgentTracker } from "../tool-calls";

const LOG_PREFIX = "[Swarm API]";

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

/**
 * The swarm stream's entry point.
 *
 * Swarm is the one mode that did not share `prepareStreamContext`: it has its
 * own request schema (the swarm agent roster and round count) and its own
 * thread initialization (`isSwarm` + `swarmAgentIds`). That setup stays
 * hand-rolled here; only the streaming loop is shared. Unifying the setup is a
 * separate change, tracked in the spec's follow-on list.
 *
 * Swarm also persists differently from every other mode: one assistant message
 * per agent turn, each reported on its own `agent_turn_end`, and no
 * `message_saved` at all. That is the runner's `persistence: "external"`.
 */
export async function handleSwarmStream(req: NextRequest): Promise<Response> {
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
    // Rebound after the null guard: TypeScript does not carry a narrowed
    // `user` into the closures below.
    const { id: userId, name: userName, email: userEmail } = user;

    const { threadId: currentThreadId, isNewThread } =
      await StreamPipeline.initializeThread(
        userId,
        userName,
        userEmail,
        { ...body, model: body.model } as Parameters<
          typeof StreamPipeline.initializeThread
        >[3],
        false,
        { isSwarm: true, swarmAgentIds: body.swarmAgentIds },
      );

    const existingMessages = await store.getMessages(currentThreadId);
    const isFirstMessage = existingMessages.length === 0;

    const processedDocuments = await processDocuments(
      body.documents ?? [],
      userId,
      LOG_PREFIX,
    );
    const { processedImages, imagesForAI: newImagesForAI } =
      await processImages(body.images ?? [], userId, LOG_PREFIX);
    const historicalImages = await getHistoricalImages(
      existingMessages,
      userId,
      LOG_PREFIX,
    );
    const imagesForAI = [...newImagesForAI, ...historicalImages];

    const savedUserMessage = await store.addMessage(currentThreadId, {
      threadId: currentThreadId,
      userId,
      userName,
      userEmail,
      role: "user",
      content: body.message,
      model: body.model,
      documents: processedDocuments.length > 0 ? processedDocuments : undefined,
      images: processedImages.length > 0 ? processedImages : undefined,
    });

    const messages = await hydrateMessages(
      [...existingMessages, savedUserMessage],
      userId,
      LOG_PREFIX,
    );

    const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
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

    // Swarm has no main agent, so it loads only what depends on the user.
    const tooling = await loadUserTooling({
      userId,
      customToolSelection: "all-enabled",
    });

    const connectors = filterConnectors({
      allServers: tooling.allServers,
      secretMap: tooling.secretMap,
      extraRequiredTools: validAgents.flatMap((a) => a.tools ?? []),
    });

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

    const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";

    // Per-turn accumulation, and the map that reconciles a result's source id
    // back to the UI id its start was written under.
    const agentContentMap = new Map<string, string>();
    const agentToolCallsMap = new Map<string, PersistedToolCall[]>();
    const activeToolCallsByEventId = new Map<string, string>();
    const agentTokensMap = new Map<
      string,
      { prompt: number; completion: number }
    >();

    async function* produce(): AsyncGenerator<ProducerEvent> {
      for await (const event of swarmAgentService.streamSwarm({
        messages,
        agents: swarmAgentConfigs,
        defaultModelId: body.model,
        connectors,
        images: imagesForAI,
        modelOptions: {
          temperature: body.temperature,
          topP: body.topP,
        },
        userContext: {
          userId,
          name: userName,
          email: userEmail,
          timezone,
        },
        customToolsLookup: tooling.customToolsLookup,
        maxRounds: body.maxRounds,
      })) {
        switch (event.type) {
          case "agent_turn_start":
            if (event.agentId) {
              agentContentMap.set(event.agentId, "");
              agentToolCallsMap.set(event.agentId, []);
            }
            yield {
              type: "passthrough",
              payload: {
                type: "agent_turn_start",
                agentId: event.agentId,
                agentName: event.agentName,
              },
            };
            break;

          case "token":
            // A token with no agent to attribute it to is dropped rather than
            // streamed unattributed.
            if (!event.content || !event.agentId) break;
            agentContentMap.set(
              event.agentId,
              (agentContentMap.get(event.agentId) || "") + event.content,
            );
            yield {
              type: "token",
              content: event.content,
              meta: { agentId: event.agentId, agentName: event.agentName },
            };
            break;

          case "tool_call_start": {
            const toolCallId = event.toolCallId || generateId();
            if (event.toolCallId) {
              activeToolCallsByEventId.set(event.toolCallId, toolCallId);
            }

            const toolCall: PersistedToolCall = {
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

            yield {
              type: "tool_start",
              sourceId: event.toolCallId,
              name: event.toolName || "unknown_tool",
              args: event.toolArgs || {},
              meta: { agentId: event.agentId, agentName: event.agentName },
            };
            break;
          }

          case "tool_result": {
            const matchedToolCallId = event.toolCallId
              ? activeToolCallsByEventId.get(event.toolCallId) ||
                event.toolCallId
              : undefined;
            if (event.toolCallId) {
              activeToolCallsByEventId.delete(event.toolCallId);
            }

            if (event.agentId) {
              const calls = agentToolCallsMap.get(event.agentId) || [];
              const matchedToolCall = calls.find(
                (tc) => tc.id === matchedToolCallId,
              );
              if (matchedToolCall) {
                matchedToolCall.result = event.toolResult;
              }
            }

            yield {
              type: "tool_result",
              sourceId: event.toolCallId,
              result: event.toolResult ?? "",
              meta: { agentId: event.agentId, agentName: event.agentName },
            };
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
              yield {
                type: "token_usage",
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                totalTokens: event.totalTokens,
              };
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
              userName,
              userEmail,
              role: "assistant",
              content: endContent,
              model:
                swarmAgentConfigs.find((a) => a.id === agentId)?.modelId ||
                body.model,
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

            yield {
              type: "passthrough",
              payload: {
                type: "agent_turn_end",
                agentId: event.agentId,
                agentName: event.agentName,
                messageId: savedMsg.id,
              },
            };
            break;
          }

          case "routing":
            yield {
              type: "passthrough",
              payload: {
                type: "routing",
                round: event.round,
                routedAgents: event.routedAgents,
                routingReason: event.routingReason,
              },
            };
            break;

          case "round_start":
            yield {
              type: "passthrough",
              payload: { type: "round_start", round: event.round },
            };
            break;

          case "round_end":
            yield {
              type: "passthrough",
              payload: { type: "round_end", round: event.round },
            };
            break;

          // Swarm's error frame carries the agent it came from, which the
          // runner's own `error` event cannot express — so it passes through.
          case "error":
            yield {
              type: "passthrough",
              payload: {
                type: "error",
                error: event.error,
                agentId: event.agentId,
                agentName: event.agentName,
              },
            };
            break;

          // The runner emits its own `done`. Swarm never forwarded `citations`
          // either, so it must not start now.
          case "tool_call_end":
          case "citations":
          case "done":
            break;
        }
      }
    }

    const runContext: StreamRunContext = {
      user: { id: userId, name: userName, email: userEmail },
      requestBody: { message: body.message, model: body.model },
      threadId: currentThreadId,
      isNewThread,
      isFirstMessage,
      isRegeneration: false,
      savedUserMessageId: savedUserMessage.id,
    };

    return runTokenStream({
      context: runContext,
      produce,
      tracker: createAgentTracker(),
      logPrefix: LOG_PREFIX,
      errorMessage: "An error occurred",
      // Each turn accounts for itself; swarm has no stream-wide total.
      persistence: "external",
      usageFallback: false,
    });
  } catch (error) {
    logger.error({ err: error }, "Swarm stream error");
    return handleError(error, "Swarm stream");
  }
}
