import { NextRequest } from "next/server";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { CronExpressionParser } from "cron-parser";
import { validateWorkflowSteps } from "@/lib/workflow/validation";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!workflowStore)
      return api.serviceUnavailable("Database not configured");

    const { id } = await params;

    // Try step-based workflow first, then fall back to rich workflow
    const workflow = await workflowStore.getWorkflow(id);
    if (workflow) {
      if (workflow.userId !== user.id) return api.forbidden();
      return api.success(workflow);
    }

    const richWorkflow = await workflowStore.getRichWorkflow(id);
    if (richWorkflow) {
      if (richWorkflow.userId !== user.id) return api.forbidden();
      return api.success(richWorkflow);
    }

    return api.notFound("Workflow");
  } catch (error) {
    return handleError(error, "Fetch workflow");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!workflowStore)
      return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "workflows_write",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;
    const body = await request.json();

    // Try step-based workflow first
    const existingWorkflow = await workflowStore.getWorkflow(id);
    if (existingWorkflow) {
      if (existingWorkflow.userId !== user.id) return api.forbidden();

      const updates = { ...body };

      if (body.steps !== undefined) {
        if (!Array.isArray(body.steps) || body.steps.length === 0) {
          return api.badRequest("At least one step is required");
        }

        const validation = validateWorkflowSteps(body.steps);
        if (!validation.valid) {
          return api.badRequest(validation.errors[0]);
        }
      }

      if (body.trigger) {
        if (
          body.trigger.type === "schedule" &&
          body.trigger.config?.cronExpression
        ) {
          try {
            const interval = CronExpressionParser.parse(
              body.trigger.config.cronExpression,
            );
            updates.nextRunAt = interval.next().toISOString();
          } catch {
            return api.badRequest("Invalid cron expression");
          }
        } else {
          updates.nextRunAt = null;
        }
      }

      const workflow = await workflowStore.updateWorkflow(id, updates);
      if (!workflow) return api.serverError("Failed to update workflow");
      return api.success(workflow);
    }

    // Fall back to rich workflow metadata update
    const richWorkflow = await workflowStore.getRichWorkflow(id);
    if (richWorkflow) {
      if (richWorkflow.userId !== user.id) return api.forbidden();
      const { name, description, isPublished, visibility, icon } = body;
      const updated = await workflowStore.updateRichWorkflow(id, {
        name,
        description,
        isPublished,
        visibility,
        icon,
      });
      if (!updated) return api.serverError("Failed to update workflow");
      return api.success(updated);
    }

    return api.notFound("Workflow");
  } catch (error) {
    return handleError(error, "Update workflow");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!workflowStore)
      return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "workflows_write",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;

    // Try step-based workflow first
    const existingWorkflow = await workflowStore.getWorkflow(id);
    if (existingWorkflow) {
      if (existingWorkflow.userId !== user.id) return api.forbidden();
      const success = await workflowStore.deleteWorkflow(id);
      if (!success) return api.serverError("Failed to delete workflow");
      return api.success({ success: true });
    }

    // Fall back to rich workflow
    const richWorkflow = await workflowStore.getRichWorkflow(id);
    if (richWorkflow) {
      if (richWorkflow.userId !== user.id) return api.forbidden();
      const success = await workflowStore.deleteRichWorkflow(id);
      if (!success) return api.serverError("Failed to delete workflow");
      return api.success({ success: true });
    }

    return api.notFound("Workflow");
  } catch (error) {
    return handleError(error, "Delete workflow");
  }
}
