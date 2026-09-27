import cron from "node-cron";
import { logger } from "@/lib/logger";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { Agent, ToolSecret } from "@/lib/types";
import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import { CronExpressionParser } from "cron-parser";
import { validateWorkflowSteps } from "@/lib/workflow/validation";

let isSchedulerRunning = false;

export function startInternalCron() {
    // Ensure this only runs once
    if (isSchedulerRunning) return;
    
    // In Next.js, instrumentation runs in Edge and Node environments.
    // We only want to run background tasks in Node.js
    if (process.env.NEXT_RUNTIME === 'edge') return;

    logger.info("Starting internal background cron scheduler...");
    isSchedulerRunning = true;

    // Run every minute
    cron.schedule("* * * * *", async () => {
        logger.info("[Internal Cron] Running background scheduler evaluation...");
        
        const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;
        const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
        const mcpStore = isDatabaseConfigured() ? new MCPStore() : null;

        if (!workflowStore || !agentStore || !mcpStore) {
            logger.warn("[Internal Cron] Database not configured, skipping execution.");
            return;
        }

        try {
            // 1. Optimized Query: Only fetch workflows that are actually due
            const scheduledWorkflows = await workflowStore.getScheduledWorkflows();
            const now = new Date();
            const nowISO = now.toISOString();

            for (const workflow of scheduledWorkflows) {
                if (!workflow.trigger?.config?.cronExpression) continue;

                const validation = validateWorkflowSteps(workflow.steps);
                if (!validation.valid) {
                    logger.error(`[Internal Cron] Invalid workflow ${workflow.id}: ${validation.errors[0]}`);
                    continue;
                }

                const cronExpression = workflow.trigger.config.cronExpression;
                
                try {
                    // 2. Calculate the NEXT occurrence after the current execution
                    const interval = CronExpressionParser.parse(cronExpression, { currentDate: now });
                    const nextRunAt = interval.next().toISOString();

                    // 3. Atomic Claim: Try to update the schedule. 
                    // This claims via the store's `updatedAt` version token, so only one instance wins.
                    const claimed = await workflowStore.updateWorkflowSchedule(
                        workflow.id, 
                        workflow.userId, 
                        nowISO, 
                        nextRunAt
                    );

                    if (!claimed) {
                        // Another instance already picked this up
                        continue;
                    }

                    logger.info(`[Internal Cron] Triggering scheduled workflow ${workflow.id}`);

                    const userId = workflow.userId;

                    const agentMap = new Map<string, Agent>();
                    let hasMissingAgents = false;
                    for (const step of workflow.steps) {
                        const stepAgentId = step.agentId?.trim();
                        if (!stepAgentId) {
                            logger.error(`[Internal Cron] Step "${step.name}" is missing agent in workflow ${workflow.id}`);
                            hasMissingAgents = true;
                            continue;
                        }

                        if (!agentMap.has(stepAgentId)) {
                            const agent = await agentStore.getAgent(stepAgentId);
                            if (agent) {
                                agentMap.set(stepAgentId, agent);
                            } else {
                                logger.error(`[Internal Cron] Agent "${stepAgentId}" not found for workflow ${workflow.id}`);
                                hasMissingAgents = true;
                            }
                        }
                    }

                    if (hasMissingAgents) {
                        continue;
                    }

                    const mcpServers = await mcpStore.getMCPServers(userId);
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

                    const eventGenerator = workflowExecutionService.executeWorkflow({
                        workflowId: workflow.id,
                        workflowName: workflow.name,
                        userId,
                        userName: workflow.userName,
                        userEmail: workflow.userEmail,
                        steps: workflow.steps,
                        agents: agentMap,
                        initialMessage: "Triggered via internal scheduled cron job",
                        mcpServers: resolvedMcpServers,
                    });

                    // Process stream silently in background
                    const processStream = async () => {
                         try {
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            for await (const _ of eventGenerator) {
                                // iterate to consume and run
                            }
                         } catch (error) {
                             logger.error({ err: error }, `[Internal Cron] Scheduled workflow execution error for ${workflow.id}`);
                         }
                    };
                    
                    processStream();
                } catch {
                    logger.error(`[Internal Cron] Invalid cron expression or evaluation error for workflow ${workflow.id}: ${cronExpression}`);
                    continue;
                }
            }
        } catch (error) {
            logger.error({ err: error }, "[Internal Cron] Error evaluating workflows");
        }
    });
}
