import { NextRequest } from "next/server";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

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

    const richWorkflow = await workflowStore.getRichWorkflow(id);
    if (richWorkflow) {
      if (richWorkflow.userId !== user.id) return api.forbidden();

      const { name, description, isPublished, visibility, icon, trigger } = body;

      const updated = await workflowStore.updateRichWorkflow(id, {
        name,
        description,
        isPublished,
        visibility,
        icon,
        trigger,
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
