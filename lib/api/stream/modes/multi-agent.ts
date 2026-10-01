import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { multiAgentService } from "@/lib/langchain/multi-agent-service";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { createUseSkillTool } from "@/lib/tool/default-tools";
import { handleError, api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { StreamPipeline, type StreamContext } from "@/lib/api/stream-pipeline";
import {
  loadAgentContext,
  filterMcpServers,
  toSnakeCase,
  type AgentContext,
} from "../context";
import { buildAssistantPayload, type ProducerEvent } from "../events";
import {
  runTokenStream,
  type StreamAccumulator,
  type StreamRunContext,
} from "../runner";
import { createMultiAgentTracker } from "../tool-calls";

const LOG_PREFIX = "[Multi-Agent API]";

interface SubAgentParams {
  id: string;
  name: string;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
  allowedTools?: string[];
}

/**
 * The sub-agent records, fetched only once the main agent is known — this is
 * the ordering that keeps `loadAgentContext` and `filterMcpServers` separate
 * functions. A sub-agent that fails to load is dropped, not fatal.
 */
async function loadSubAgents(
  subAgents: { id: string; name: string }[] | undefined,
): Promise<SubAgentParams[]> {
  const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
  if (!agentStore || !subAgents?.length) return [];

  logger.info(`Fetching details for ${subAgents.length} sub-agents`);
  const results = await Promise.all(
    subAgents.map((sub) =>
      agentStore.getAgent(sub.id).catch((err) => {
        logger.warn(`Failed to fetch sub-agent ${sub.name} (${sub.id})`, err);
        return null;
      }),
    ),
  );

  const loaded: SubAgentParams[] = [];
  for (const record of results) {
    if (!record) continue;
    loaded.push({
      id: record.id,
      name: record.name,
      systemPrompt: record.systemPrompt,
      modelId: record.modelId,
      temperature: record.temperature,
      topP: record.topP,
      allowedTools: record.tools,
    });
  }
  return loaded;
}

/**
 * The multi-agent mode's setup: the shared agent context, the sub-agent round
 * that can only run after it, and the sub-agent index every streamed event is
 * resolved against.
 *
 * Sub-agent events are dropped before they reach the runner. That filter has to
 * live here — the runner sees a flat event stream and has no way to tell a
 * sub-agent's turn from the supervisor's.
 */
export async function buildMultiAgentMode(params: {
  context: StreamContext;
  agentContext: AgentContext;
  timezone: string;
}) {
  const { context, agentContext, timezone } = params;
  const { user, requestBody } = context;
  const { model, systemPrompt, temperature, topP } = requestBody;
  const userId = user.id;

  const { agent, customToolsLookup } = agentContext;

  const fullSubAgents = await loadSubAgents(agent?.subAgents);

  // The request's own values win; the agent record only fills the gaps.
  const effectiveTemperature = temperature ?? agent?.temperature;
  const effectiveTopP = topP ?? agent?.topP;

  // `loadAgentContext` already mutated `agent.systemPrompt` with exactly this
  // suffix — the identity prompt and, when the agent has skills, the catalog.
  const effectiveSystemPrompt =
    (systemPrompt ?? "") + agentContext.systemPromptSuffix;

  if (agent?.skills && agent.skills.length > 0) {
    customToolsLookup.set("use_skill", createUseSkillTool(agent.skills));
  }

  const mcpServers = filterMcpServers({
    allServers: agentContext.allServers,
    secretMap: agentContext.secretMap,
    allowedTools: agentContext.allowedTools,
    extraRequiredTools: fullSubAgents.flatMap((sub) => sub.allowedTools ?? []),
  });

  const subAgentByKey = new Map<string, { id: string; name: string }>();
  for (const sub of fullSubAgents) {
    const target = { id: sub.id, name: sub.name };
    subAgentByKey.set(sub.id, target);
    subAgentByKey.set(toSnakeCase(sub.name), target);
  }

  /**
   * Supervisor and sub-agent tool calls can share a name, so an event's owner
   * is resolved by agent id first and by its normalized name second.
   */
  const resolveSubAgent = (agentId?: string, agentName?: string) =>
    (agentId ? subAgentByKey.get(agentId) : undefined) ??
    (agentName ? subAgentByKey.get(toSnakeCase(agentName)) : undefined);

  async function* produce(): AsyncGenerator<ProducerEvent> {
    for await (const event of multiAgentService.streamAgent({
      messages: context.messages,
      modelId: model,
      systemPrompt: effectiveSystemPrompt,
      mcpServers,
      images: context.imagesForAI,
      modelOptions: {
        temperature: effectiveTemperature,
        topP: effectiveTopP,
      },
      userContext: {
        userId,
        name: user.name,
        email: user.email,
        timezone,
      },
      customToolsLookup,
      subAgents: fullSubAgents,
    })) {
      switch (event.type) {
        case "token": {
          if (!event.content) break;
          // Nothing a sub-agent says reaches the client.
          if (resolveSubAgent(event.agentId, event.agentName)) break;

          // `agentName` is deliberately dropped — the client resolves the
          // supervisor's display name from its own agent prop, not the
          // LangGraph node name.
          yield {
            type: "token",
            content: event.content,
            meta: {
              agentId: event.agentId,
              agentName: undefined,
              parentToolCallId: undefined,
            },
          };
          break;
        }

        case "tool_call_start": {
          const subAgent = resolveSubAgent(event.agentId, event.agentName);
          if (subAgent) break;

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
          const subAgent = resolveSubAgent(event.agentId, event.agentName);
          if (subAgent) break;

          yield {
            type: "tool_result",
            sourceId: event.toolCallId,
            name: event.toolName,
            result: event.toolResult ?? "",
            meta: { agentId: event.agentId, agentName: event.agentName },
          };
          break;
        }

        case "citations":
          yield { type: "citations", citations: event.citations ?? [] };
          break;

        case "token_usage":
          // Only a complete usage triple is reported; a partial one is dropped.
          if (
            event.promptTokens !== undefined &&
            event.completionTokens !== undefined &&
            event.totalTokens !== undefined
          ) {
            yield {
              type: "token_usage",
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              totalTokens: event.totalTokens,
            };
          }
          break;

        case "error":
          yield { type: "error", error: event.error ?? "" };
          break;

        // The runner emits its own `done`.
        case "tool_call_end":
        case "done":
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
      toolCalls: accumulator.toolCalls,
      citations: accumulator.citations,
      usage: accumulator.usage,
      fallback,
      pairedUserVersionId: context.pairedUserVersionId,
    });
  }

  return { produce, buildPayload };
}

export async function handleMultiAgentStream(
  req: NextRequest,
): Promise<Response> {
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

    const context = await StreamPipeline.prepareStreamContext(
      req,
      true,
      LOG_PREFIX,
    );
    logger.info("Multi-Agent messages for processing:", context.messages.length);

    const agentContext = await loadAgentContext({
      userId: context.user.id,
      agentId: context.requestBody.agentId ?? "",
      customToolSelection: "all-enabled",
      logPrefix: LOG_PREFIX,
    });

    const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";
    const mode = await buildMultiAgentMode({ context, agentContext, timezone });

    const runContext: StreamRunContext = context;

    return runTokenStream({
      context: runContext,
      produce: mode.produce,
      tracker: createMultiAgentTracker(),
      buildPayload: mode.buildPayload,
      logPrefix: LOG_PREFIX,
      errorMessage: "An error occurred",
      producerError: "forward",
    });
  } catch (error) {
    logger.error({ err: error }, "Agent stream error");
    return handleError(error, "Multi-agent stream");
  }
}
