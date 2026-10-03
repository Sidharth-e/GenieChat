import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { RichWorkflow } from "@/lib/types";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!workflowStore) {
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

        const richWorkflow = await workflowStore.getRichWorkflow(id);
        if (!richWorkflow) return api.notFound("Workflow");
        if (richWorkflow.userId !== user.id) return api.forbidden();

        return handleRichWorkflowExecution(richWorkflow, request);
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
