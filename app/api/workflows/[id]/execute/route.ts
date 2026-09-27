import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { MCPStore } from "@/lib/mongodb/mcp-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { Agent, RichWorkflow, ToolSecret } from "@/lib/types";
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
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!workflowStore || !agentStore || !mcpStore) {
            return api.serviceUnavailable("Database not configured");
        }

        const rateLimit = await checkRateLimit(request, {
            namespace: "workflows_execute",
            identifier: user.id,
            ...config.rateLimit.strict,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const { id } = await params;

        // Check for rich workflow first
        const richWorkflow = await workflowStore.getRichWorkflow(id);
        if (richWorkflow) {
            if (richWorkflow.userId !== user.id) return api.forbidden();
            return handleRichWorkflowExecution(richWorkflow, request);
        }

        // Fall back to step-based workflow
        const workflow = await workflowStore.getWorkflow(id);

        if (!workflow) return api.notFound("Workflow");
        if (workflow.userId !== user.id) return api.forbidden();

        const validation = validateWorkflowSteps(workflow.steps);
        if (!validation.valid) {
            return api.badRequest(validation.errors[0]);
        }

        const body = await request.json();
        const { message } = body;

        if (!message) return api.badRequest("Message is required");

        const agentMap = new Map<string, Agent>();
        for (const step of workflow.steps) {
            const stepAgentId = step.agentId?.trim();
            if (!stepAgentId) {
                return api.badRequest(`Agent step "${step.name}" is missing an agent.`);
            }

            if (!agentMap.has(stepAgentId)) {
                const agent = await agentStore.getAgent(stepAgentId);
                if (!agent) {
                    return api.badRequest(`Agent "${stepAgentId}" was not found for step "${step.name}".`);
                }
                agentMap.set(stepAgentId, agent);
            }
        }

        const allMcpServers = await mcpStore.getMCPServers(user.id);
        const mcpServers = allMcpServers.filter(server => server.enabled);
        let userSecrets: ToolSecret[] = [];
        if (isDatabaseConfigured()) {
            const secretStore = new SecretStore();
            userSecrets = await secretStore.getSecrets(user.id);
        }

        const secretMap = userSecrets.reduce(
            (acc, secret) => {
                acc[secret.name] = secret.value;
                return acc;
            },
            {} as Record<string, string>,
        );
        const resolvedMcpServers = resolveMCPServerSecrets(mcpServers, secretMap);

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const eventGenerator = workflowExecutionService.executeWorkflow({
                        workflowId: workflow.id,
                        workflowName: workflow.name,
                        userId: user.id,
                        userName: user.name,
                        userEmail: user.email,
                        steps: workflow.steps,
                        agents: agentMap,
                        initialMessage: message,
                        mcpServers: resolvedMcpServers,
                    });

                    for await (const event of eventGenerator) {
                        const sseData = {
                            type: event.type,
                            stepId: event.stepId,
                            stepIndex: event.stepIndex,
                            stepName: event.stepName,
                            agentId: event.agentId,
                            agentName: event.agentName,
                            content: event.content,
                            result: event.result,
                            error: event.error,
                            toolName: event.toolName,
                            toolArgs: event.toolArgs,
                            toolCallId: event.toolCallId,
                            toolResult: event.toolResult,
                            duration: event.duration,
                            finalResult: event.finalResult,
                            tokens: event.tokens,
                        };

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseData)}\n\n`));
                    }
                } catch (error) {
                    logger.error({ err: error }, "Workflow execution error");
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({
                                type: "workflow_error",
                                error: error instanceof Error ? error.message : "Execution failed",
                            })}\n\n`,
                        ),
                    );
                } finally {
                    controller.close();
                }
            }
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        return handleError(error, "Execute workflow");
    }
}

async function handleRichWorkflowExecution(
    workflow: RichWorkflow,
    request: NextRequest,
): Promise<NextResponse> {
    const body = await request.json();
    const { query } = body;

    if (!query) return api.badRequest("Query is required");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                const eventGenerator = workflowExecutionService.executeRichWorkflow({
                    workflow,
                    query,
                });

                for await (const event of eventGenerator) {
                    controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
                }
            } catch (error) {
                logger.error({ err: error }, "Rich workflow execution error");
                controller.enqueue(
                    encoder.encode(
                        JSON.stringify({
                            eventType: "WORKFLOW_END",
                            error: error instanceof Error ? error.message : "Execution failed",
                        }) + "\n",
                    ),
                );
            } finally {
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
