import { NextRequest } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { Agent, ToolSecret } from "@/lib/types";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { validateWorkflowSteps } from "@/lib/workflow/validation";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;
const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!workflowStore || !agentStore || !mcpStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const rateLimit = await checkRateLimit(request, {
      namespace: "workflows_trigger",
      ...config.rateLimit.strict,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;
    const workflow = await workflowStore.getWorkflow(id);

    if (!workflow) return api.notFound("Workflow");

    const validation = validateWorkflowSteps(workflow.steps);
    if (!validation.valid) {
      return api.badRequest(validation.errors[0]);
    }

    // Validate trigger
    if (!workflow.trigger || workflow.trigger.type !== "webhook") {
      return api.forbidden("Workflow is not configured for webhook trigger");
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    const configuredSecret = workflow.trigger.config?.webhookSecret;

    if (!configuredSecret) {
      return api.unauthorized("Webhook secret not configured");
    }

    const secretsMatch =
      token.length === configuredSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(configuredSecret));

    if (!secretsMatch) {
      return api.unauthorized("Invalid webhook secret");
    }

    // Parse body for initial message
    const MESSAGE_MAX = 4096;
    let message = "Triggered via webhook";
    try {
      const body = await request.json();
      if (body.message && typeof body.message === "string") {
        message = body.message.slice(0, MESSAGE_MAX);
      } else {
        message = JSON.stringify(body).slice(0, MESSAGE_MAX);
      }
    } catch {
      // body is not JSON, use default message
    }

    const userId = workflow.userId;

    const agentMap = new Map<string, Agent>();
    for (const step of workflow.steps) {
      const stepAgentId = step.agentId?.trim();
      if (!stepAgentId) {
        return api.badRequest(`Agent step "${step.name}" is missing an agent.`);
      }

      if (!agentMap.has(stepAgentId)) {
        const agent = await agentStore.getAgent(stepAgentId);
        if (!agent) {
          return api.badRequest(
            `Agent "${stepAgentId}" was not found for step "${step.name}".`,
          );
        }
        agentMap.set(stepAgentId, agent);
      }
    }

    const allMcpServers = await mcpStore.getMCPServers(userId);
    const mcpServers = allMcpServers.filter((server) => server.enabled);
    let userSecrets: ToolSecret[] = [];
    if (isDatabaseConfigured()) {
      const secretStore = new SecretStore();
      userSecrets = await secretStore.getSecrets(userId);
    }

    const secretMap = userSecrets.reduce(
      (acc, secret) => {
        acc[secret.name] = secret.value;
        return acc;
      },
      {} as Record<string, string>,
    );
    const resolvedMcpServers = resolveMCPServerSecrets(mcpServers, secretMap);

    // Start execution
    const eventGenerator = workflowExecutionService.executeWorkflow({
      workflowId: workflow.id,
      workflowName: workflow.name,
      userId,
      userName: workflow.userName,
      userEmail: workflow.userEmail,
      steps: workflow.steps,
      agents: agentMap,
      initialMessage: message,
      mcpServers: resolvedMcpServers,
    });

    // We grab the executionId from the first event
    let executionId = "";
    const firstEvent = await eventGenerator.next();
    if (!firstEvent.done && firstEvent.value.type === "workflow_start") {
      executionId = firstEvent.value.finalResult || "";
    }

    // Process the rest of the stream asynchronously without awaiting it here
    const processStream = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const event of eventGenerator) {
          // Just iterate to consume and run the steps
        }
      } catch (error) {
        logger.error({ err: error }, "Webhook workflow execution error");
      }
    };

    processStream(); // fire and forget

    return api.success({
      success: true,
      executionId,
      message: "Workflow triggered successfully",
    });
  } catch (error) {
    return handleError(error, "Trigger workflow");
  }
}
