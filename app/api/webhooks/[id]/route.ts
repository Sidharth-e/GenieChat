import { NextRequest } from "next/server";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;
const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;
const agentStore = isDatabaseConfigured() ? new AgentStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveTargetName(
  targetType: "workflow" | "agent",
  targetId: string,
): Promise<string | undefined> {
  if (targetType === "workflow" && workflowStore) {
    const rich = await workflowStore.getRichWorkflow(targetId);
    return rich?.name;
  }
  if (targetType === "agent" && agentStore) {
    const agent = await agentStore.getAgent(targetId);
    return agent?.name;
  }
  return undefined;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const webhook = await webhookStore.getById(id, user.id);

    if (!webhook) return api.notFound("Webhook");

    const targetName = await resolveTargetName(
      webhook.target.type,
      webhook.target.id,
    );

    return api.success({ ...webhook, targetName });
  } catch (error) {
    return handleError(error, "Fetch webhook");
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "webhooks_write",
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
    const { name, description, target, enabled } = body;

    const updated = await webhookStore.update(id, user.id, {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(target !== undefined && { target }),
      ...(enabled !== undefined && { enabled }),
    });

    if (!updated) return api.notFound("Webhook");

    return api.success(updated);
  } catch (error) {
    return handleError(error, "Update webhook");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "webhooks_write",
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
    const deleted = await webhookStore.delete(id, user.id);

    if (!deleted) return api.notFound("Webhook");

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete webhook");
  }
}
