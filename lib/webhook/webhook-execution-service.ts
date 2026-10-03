import "server-only";
import { logger } from "@/lib/logger";
import { Webhook, WebhookInvocation } from "@/lib/types";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { runAgentTarget } from "@/lib/schedules/run-agent";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;
const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

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
    // succeed. `error` carries the reason; the fallback covers an
    // `isOk: false` event that arrives without one.
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
  if (!webhookStore) throw new Error("Database not configured");

  const { threadId } = await runAgentTarget({
    userId: webhook.userId,
    agentId: webhook.target.id,
    message,
    onStarted: (startedThreadId) =>
      webhookStore!
        .updateInvocation(invocation.id, webhook.userId, {
          status: "running",
          executionId: startedThreadId,
        })
        .then(() => undefined),
  });

  await webhookStore.updateInvocation(invocation.id, webhook.userId, {
    status: "completed",
    executionId: threadId,
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
