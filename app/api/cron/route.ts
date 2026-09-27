import { NextRequest } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { Agent, ToolSecret } from "@/lib/types";
import { api, handleError } from "@/lib/api-utils";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { CronExpressionParser } from "cron-parser";
import { validateWorkflowSteps } from "@/lib/workflow/validation";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;
const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

export async function GET(request: NextRequest) {
  try {
    if (!workflowStore || !agentStore || !mcpStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    const cronSecret = env.CRON_SECRET;

    if (!cronSecret) {
      return api.unauthorized("Cron secret not configured");
    }

    const secretsMatch =
      token.length === cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret));

    if (!secretsMatch) {
      return api.unauthorized("Invalid cron secret");
    }

    const scheduledWorkflows = await workflowStore.getScheduledWorkflows();
    const now = new Date();
    const nowISO = now.toISOString();
    const triggeredWorkflowIds: string[] = [];

    for (const workflow of scheduledWorkflows) {
      if (!workflow.trigger?.config?.cronExpression) continue;

      const validation = validateWorkflowSteps(workflow.steps);
      if (!validation.valid) {
        logger.error(
          `Skipping invalid workflow ${workflow.id}: ${validation.errors[0]}`,
        );
        continue;
      }

      const cronExpression = workflow.trigger.config.cronExpression;

      try {
        // Calculate the NEXT occurrence after the current execution
        const interval = CronExpressionParser.parse(cronExpression, {
          currentDate: now,
        });
        const nextRunAt = interval.next().toISOString();

        // Atomic Claim: Try to update the schedule.
        // This claims via the store's `updatedAt` version token, so only one instance wins.
        const claimed = await workflowStore.updateWorkflowSchedule(
          workflow.id,
          workflow.userId,
          nowISO,
          nextRunAt,
        );

        if (!claimed) {
          // Another instance (or the internal scheduler) already picked this up
          continue;
        }

        logger.info(`Triggering scheduled workflow ${workflow.id}`);
        triggeredWorkflowIds.push(workflow.id);

        // Fetch resources required to run the workflow
        const userId = workflow.userId;

        const agentMap = new Map<string, Agent>();
        let hasMissingAgents = false;
        for (const step of workflow.steps) {
          const stepAgentId = step.agentId?.trim();
          if (!stepAgentId) {
            logger.error(
              `Step "${step.name}" is missing agent in workflow ${workflow.id}`,
            );
            hasMissingAgents = true;
            continue;
          }

          if (!agentMap.has(stepAgentId)) {
            const agent = await agentStore.getAgent(stepAgentId);
            if (agent) {
              agentMap.set(stepAgentId, agent);
            } else {
              logger.error(
                `Agent "${stepAgentId}" not found for workflow ${workflow.id}`,
              );
              hasMissingAgents = true;
            }
          }
        }

        if (hasMissingAgents) {
          continue;
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
        const resolvedMcpServers = resolveMCPServerSecrets(
          mcpServers,
          secretMap,
        );

        // Start execution
        const eventGenerator = workflowExecutionService.executeWorkflow({
          workflowId: workflow.id,
          workflowName: workflow.name,
          userId,
          steps: workflow.steps,
          agents: agentMap,
          initialMessage: "Triggered via scheduled cron job",
          mcpServers: resolvedMcpServers,
        });

        // Fire and forget
        const processStream = async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const event of eventGenerator) {
              // iterate to consume and run the steps
            }
          } catch (error) {
            logger.error(
              { err: error },
              `Scheduled workflow execution error for ${workflow.id}`,
            );
          }
        };

        processStream();
      } catch {
        logger.error(
          `Invalid cron expression for workflow ${workflow.id}: ${cronExpression}`,
        );
        continue;
      }
    }

    return api.success({
      success: true,
      message: `Evaluated ${scheduledWorkflows.length} scheduled workflows. Triggered ${triggeredWorkflowIds.length}.`,
      triggeredWorkflowIds,
    });
  } catch (error) {
    return handleError(error, "Cron execution");
  }
}
