import { NextRequest } from "next/server";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { NodeKind } from "@/lib/workflow/types";
import { createNodeData } from "@/lib/workflow/create-node";
import { nextRunAtFor } from "@/lib/workflow/schedule";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { name, description, trigger } = body;

    if (!name) return api.badRequest("Name is required");

    let nextRunAt: string | undefined;
    if (trigger !== undefined) {
      try {
        nextRunAt = nextRunAtFor(trigger, new Date()) ?? undefined;
      } catch {
        return api.badRequest("Invalid cron expression");
      }
    }

    // Create default Input and Output nodes
    const inputData = createNodeData(NodeKind.Input);
    const outputData = createNodeData(NodeKind.Output);

    const workflow = await workflowStore.createRichWorkflow({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      name,
      description: description || "",
      trigger,
      nextRunAt,
      nodes: [
        {
          id: inputData.id,
          kind: NodeKind.Input,
          name: inputData.name,
          data: inputData,
          position: { x: 0, y: 0 },
        },
        {
          id: outputData.id,
          kind: NodeKind.Output,
          name: outputData.name,
          data: outputData,
          position: { x: 500, y: 0 },
        },
      ],
      edges: [],
    });

    return api.created(workflow);
  } catch (error) {
    return handleError(error, "Create node workflow");
  }
}
