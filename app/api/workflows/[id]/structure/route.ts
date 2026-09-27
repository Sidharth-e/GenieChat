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
    const workflow = await workflowStore.getRichWorkflow(id);

    if (!workflow) return api.notFound("Workflow");
    if (workflow.userId !== user.id) return api.forbidden();

    const diff = await request.json();
    const updated = await workflowStore.updateRichWorkflowStructure(id, diff);

    if (!updated) return api.notFound("Workflow");

    return api.success(updated);
  } catch (error) {
    return handleError(error, "Update workflow structure");
  }
}
