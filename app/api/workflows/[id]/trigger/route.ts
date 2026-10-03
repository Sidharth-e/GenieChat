import { NextRequest } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!workflowStore) {
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
    const workflow = await workflowStore.getRichWorkflow(id);

    if (!workflow) return api.notFound("Workflow");

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

    const eventGenerator = workflowExecutionService.executeRichWorkflow({
      workflow,
      query: { message },
    });

    // The first event is either WORKFLOW_START (a run began, and carries its
    // execution id) or a terminal WORKFLOW_END — which is what a workflow that
    // cannot run at all produces, before any execution record exists. That case
    // must answer with the reason, not report a success that never happened.
    let executionId = "";
    const firstEvent = await eventGenerator.next();
    if (
      !firstEvent.done &&
      firstEvent.value.eventType === "WORKFLOW_END" &&
      firstEvent.value.isOk === false
    ) {
      return api.badRequest(
        firstEvent.value.error ?? "Workflow could not be started",
      );
    }
    if (!firstEvent.done && firstEvent.value.eventType === "WORKFLOW_START") {
      executionId = firstEvent.value.executionId ?? "";
    }

    void (async () => {
      try {
        // Keep this disable: `no-unused-vars` comes from
        // `eslint-config-next/typescript` and does **not** ignore an underscore
        // prefix, so `const _event` is an error without it. The loop it
        // replaces carries the same comment for the same reason.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of eventGenerator) {
          // Draining the generator is what runs the workflow.
        }
      } catch (error) {
        logger.error({ err: error }, "Webhook workflow execution error");
      }
    })();

    return api.success({
      success: true,
      executionId,
      message: "Workflow triggered successfully",
    });
  } catch (error) {
    return handleError(error, "Trigger workflow");
  }
}
