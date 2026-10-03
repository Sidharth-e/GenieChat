import "server-only";
import { logger } from "@/lib/logger";
import { Webhook, WebhookInvocation, ToolSecret, Message } from "@/lib/types";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { agentService } from "@/lib/langchain/agent-service";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { generateId } from "@/lib/utils";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;
const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;
const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;
const secretStore = isDatabaseConfigured() ? new SecretStore() : null;
const chatHistoryStore = isDatabaseConfigured() ? new ChatHistoryStore() : null;

async function loadUserSecrets(
  userId: string,
): Promise<Record<string, string>> {
  if (!secretStore) return {};
  const secrets = await secretStore.getSecrets(userId);
  return secrets.reduce(
    (acc: Record<string, string>, s: ToolSecret) => {
      acc[s.name] = s.value;
      return acc;
    },
    {},
  );
}

/**
 * Build a minimal Message object suitable for passing to agentService.streamAgent.
 */
function buildUserMessage(content: string, userId: string): Message {
  const now = new Date().toISOString();
  const id = generateId();
  return {
    id,
    threadId: "",
    userId,
    userName: "",
    userEmail: "",
    role: "user",
    content,
    versions: [
      {
        versionId: id,
        content,
        createdAt: now,
      },
    ],
    activeVersionIndex: 0,
    createdAt: now,
  };
}

async function executeWorkflowTarget(
  webhook: Webhook,
  invocation: WebhookInvocation,
  message: string,
): Promise<void> {
  if (!workflowStore || !webhookStore) {
    throw new Error("Database not configured");
  }

  const workflow = await workflowStore.getRichWorkflow(webhook.target.id);
  if (!workflow) {
    throw new Error(`Workflow ${webhook.target.id} not found`);
  }

  const query: Record<string, unknown> = { message };
  const stream = workflowExecutionService.executeRichWorkflow({
    workflow,
    query,
  });

  let executionId = "";
  let runError: string | null = null;

  for await (const event of stream) {
    if (event.eventType === "WORKFLOW_START" && event.executionId) {
      executionId = event.executionId;
      await webhookStore.updateInvocation(invocation.id, webhook.userId, {
        status: "running",
        executionId,
      });
    }
    // `isOk: false` on the terminal event is how both failure shapes arrive: a
    // workflow that could not start at all (which yields it before any
    // execution record exists) and one whose node failed mid-run. Recording
    // either as "completed" would be a success for a run that did not
    // succeed. `error` may be absent — the executor's end-of-run terminal
    // event does not carry one yet — so the fallback is load-bearing.
    if (event.eventType === "WORKFLOW_END" && event.isOk === false) {
      runError = event.error ?? "Workflow execution failed";
    }
  }

  if (runError) {
    throw new Error(runError);
  }

  await webhookStore.updateInvocation(invocation.id, webhook.userId, {
    status: "completed",
    executionId,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(invocation.triggeredAt).getTime(),
  });
}

async function executeAgentTarget(
  webhook: Webhook,
  invocation: WebhookInvocation,
  message: string,
): Promise<void> {
  if (!agentStore || !mcpStore || !chatHistoryStore || !webhookStore) {
    throw new Error("Database not configured");
  }

  const agent = await agentStore.getAgent(webhook.target.id);
  if (!agent) {
    throw new Error(`Agent ${webhook.target.id} not found`);
  }

  const modelId = agent.modelId || DEFAULT_MODEL_ID;

  // Create thread with "agent-api" threadType (closest fit for webhook use)
  const thread = await chatHistoryStore.createThread(
    webhook.userId,
    modelId,
    agent.id,
    false,
    "agent-api",
  );

  await webhookStore.updateInvocation(invocation.id, webhook.userId, {
    status: "running",
    executionId: thread.id,
  });

  const allMcpServers = await mcpStore.getMCPServers(webhook.userId);
  const enabledMcpServers = allMcpServers.filter((s) => s.enabled);
  const secretMap = await loadUserSecrets(webhook.userId);
  const resolvedMcpServers = resolveMCPServerSecrets(
    enabledMcpServers,
    secretMap,
  );

  const userMessage = buildUserMessage(message, webhook.userId);

  const systemPrompt =
    agent.systemPrompt ||
    `You are ${agent.name}. ${agent.description}`;

  const stream = agentService.streamAgent({
    messages: [userMessage],
    modelId,
    systemPrompt,
    mcpServers: resolvedMcpServers,
    allowedTools: agent.tools,
  });

  let assistantContent = "";
  for await (const event of stream) {
    if (event.type === "token" && event.content) {
      assistantContent += event.content;
    }
  }

  // Persist user and assistant messages to the thread
  await chatHistoryStore.addMessage(thread.id, {
    role: "user",
    content: message,
    userId: webhook.userId,
    threadId: thread.id,
    model: modelId,
  });

  if (assistantContent) {
    await chatHistoryStore.addMessage(thread.id, {
      role: "assistant",
      content: assistantContent,
      userId: webhook.userId,
      threadId: thread.id,
      model: modelId,
    });
  }

  await webhookStore.updateInvocation(invocation.id, webhook.userId, {
    status: "completed",
    executionId: thread.id,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(invocation.triggeredAt).getTime(),
  });
}

/**
 * Fire-and-forget webhook execution. Runs the target (workflow or agent),
 * updating the invocation record with status/timing as it progresses.
 */
export async function executeWebhookTrigger(
  webhook: Webhook,
  invocation: WebhookInvocation,
  payload: Record<string, unknown>,
): Promise<void> {
  const message =
    typeof payload.message === "string"
      ? payload.message.slice(0, 4096)
      : JSON.stringify(payload).slice(0, 4096);

  try {
    if (webhook.target.type === "workflow") {
      await executeWorkflowTarget(webhook, invocation, message);
    } else {
      await executeAgentTarget(webhook, invocation, message);
    }

    if (webhookStore) {
      await webhookStore.updateLastTriggered(webhook.id, webhook.userId);
    }
  } catch (error) {
    logger.error(
      { err: error, webhookId: webhook.id, invocationId: invocation.id },
      "Webhook execution failed",
    );

    if (webhookStore) {
      await webhookStore.updateInvocation(invocation.id, webhook.userId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(invocation.triggeredAt).getTime(),
      });
    }
  }
}
