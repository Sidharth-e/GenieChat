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

async function resolveTargetName(
  targetType: "workflow" | "agent",
  targetId: string,
): Promise<string | undefined> {
  if (targetType === "workflow" && workflowStore) {
    const rich = await workflowStore.getRichWorkflow(targetId);
    if (rich) return rich.name;
    const legacy = await workflowStore.getWorkflow(targetId);
    return legacy?.name;
  }
  if (targetType === "agent" && agentStore) {
    const agent = await agentStore.getAgent(targetId);
    return agent?.name;
  }
  return undefined;
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const webhooks = await webhookStore.getByUserId(user.id);

    const withTargetNames = await Promise.all(
      webhooks.map(async (webhook) => {
        const targetName = await resolveTargetName(
          webhook.target.type,
          webhook.target.id,
        );
        return { ...webhook, targetName };
      }),
    );

    return api.success(withTargetNames);
  } catch (error) {
    return handleError(error, "Fetch webhooks");
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { name, description, target, enabled } = body;

    if (!name) return api.badRequest("Name is required");
    if (!target?.type || !target?.id)
      return api.badRequest("Target type and id are required");
    if (!["workflow", "agent"].includes(target.type))
      return api.badRequest("Target type must be 'workflow' or 'agent'");

    const { webhook, rawSecret } = await webhookStore.create({
      userId: user.id,
      name,
      description: description || "",
      target,
      enabled: enabled !== undefined ? enabled : true,
    });

    return api.created({ ...webhook, rawSecret });
  } catch (error) {
    return handleError(error, "Create webhook");
  }
}
