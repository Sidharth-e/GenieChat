import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { agentService } from "@/lib/langchain/agent-service";
import { createUseSkillTool } from "@/lib/tool/default-tools";
import { handleError, api } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { StreamPipeline, type StreamContext } from "@/lib/api/stream-pipeline";
import {
  loadAgentContext,
  filterConnectors,
  type AgentContext,
} from "../context";
import { buildAssistantPayload, type ProducerEvent } from "../events";
import {
  runTokenStream,
  type StreamAccumulator,
  type StreamRunContext,
} from "../runner";
import { createAgentTracker } from "../tool-calls";

const LOG_PREFIX = "[AgentStream]";

/**
 * The agent mode's own setup on top of the shared `loadAgentContext`: the
 * temperature/topP inheritance from the agent record, and the `use_skill` tool.
 * The context is passed in already loaded so the route can run the `active`
 * check against it without a second round of database reads.
 */
export function buildAgentMode(params: {
  context: StreamContext;
  agentContext: AgentContext;
  timezone: string;
}) {
  const { context, agentContext, timezone } = params;
  const { user, requestBody } = context;
  const { model, systemPrompt, temperature, topP } = requestBody;
  const userId = user.id;

  const { agent } = agentContext;

  // The request's own values win; the agent record only fills the gaps.
  const effectiveTemperature = temperature ?? agent?.temperature;
  const effectiveTopP = topP ?? agent?.topP;

  // `loadAgentContext` already mutated `agent.systemPrompt` with exactly this
  // suffix — the identity prompt and, when the agent has skills, the catalog.
  const effectiveSystemPrompt =
    (systemPrompt ?? "") + agentContext.systemPromptSuffix;

  let customToolsForAgent = agentContext.customTools;
  if (agent?.skills && agent.skills.length > 0) {
    customToolsForAgent = [
      ...customToolsForAgent,
      createUseSkillTool(agent.skills),
    ];
  }

  const connectors = filterConnectors({
    allServers: agentContext.allServers,
    secretMap: agentContext.secretMap,
    allowedTools: agentContext.allowedTools,
  });

  async function* produce(): AsyncGenerator<ProducerEvent> {
    for await (const event of agentService.streamAgent({
      messages: context.messages,
      modelId: model,
      systemPrompt: effectiveSystemPrompt,
      connectors,
      allowedTools: agentContext.allowedTools,
      customTools: customToolsForAgent,
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
        threadId: context.threadId,
      },
    })) {
      switch (event.type) {
        case "token":
          if (event.content) yield { type: "token", content: event.content };
          break;

        case "tool_call_start":
          // `toolCallId` may be absent — that is what the agent tracker's
          // pending queue exists to reconcile.
          yield {
            type: "tool_start",
            sourceId: event.toolCallId,
            name: event.toolName || "",
            args: event.toolArgs || {},
          };
          break;

        case "tool_result":
          yield {
            type: "tool_result",
            sourceId: event.toolCallId,
            name: event.toolName,
            result: event.toolResult ?? "",
          };
          break;

        case "citations":
          yield { type: "citations", citations: event.citations || [] };
          break;

        case "token_usage":
          yield {
            type: "token_usage",
            promptTokens: event.promptTokens ?? 0,
            completionTokens: event.completionTokens ?? 0,
            totalTokens: event.totalTokens ?? 0,
          };
          break;

        case "error":
          yield { type: "error", error: event.error ?? "" };
          break;

        // The runner emits its own `done`; `tool_call_end` carries nothing the
        // wire or the persisted message needs.
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

/**
 * The agent stream's entry point. The `active` check is deliberately here
 * rather than in `loadAgentContext`: it is route policy, and the other agent
 * mode does not enforce it.
 */
export async function handleAgentStream(req: NextRequest): Promise<Response> {
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

    const context = await StreamPipeline.prepareStreamContext(
      req,
      false,
      LOG_PREFIX,
    );
    logger.info("Agent messages for processing:", context.messages.length);

    const agentContext = await loadAgentContext({
      userId: context.user.id,
      agentId: context.requestBody.agentId ?? "",
      customToolSelection: "allowed-only",
      logPrefix: LOG_PREFIX,
    });

    if (agentContext.agent && !agentContext.agent.active) {
      return api.forbidden("This agent has been disabled.");
    }

    const timezone = req.headers.get("x-timezone") || "Asia/Kolkata";
    const mode = buildAgentMode({ context, agentContext, timezone });

    const runContext: StreamRunContext = context;

    return runTokenStream({
      context: runContext,
      produce: mode.produce,
      tracker: createAgentTracker(),
      buildPayload: mode.buildPayload,
      logPrefix: LOG_PREFIX,
      errorMessage: "An error occurred",
      producerError: "forward",
    });
  } catch (error) {
    logger.error({ err: error }, "Agent stream error");
    return handleError(error, "Agent stream");
  }
}
