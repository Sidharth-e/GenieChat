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

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!workflowStore)
      return api.serviceUnavailable("Database not configured");

    const [workflows, richWorkflows] = await Promise.all([
      workflowStore.getWorkflows(user.id),
      workflowStore.getRichWorkflows(user.id),
    ]);

    // Merge both types into a single list, sorted by createdAt desc
    const all = [
      ...workflows.map((w) => ({ ...w, _type: "workflow" as const })),
      ...richWorkflows.map((w) => ({ ...w, _type: "rich_workflow" as const })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return api.success(all);
  } catch (error) {
    return handleError(error, "Fetch workflows");
  }
}

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
    const { name, description, steps, trigger, output, outputPosition } = body;

    if (!name) return api.badRequest("Name is required");
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return api.badRequest("At least one step is required");
    }

    const validation = validateWorkflowSteps(steps);
    if (!validation.valid) {
      return api.badRequest(validation.errors[0]);
    }

    let nextRunAt: string | undefined = undefined;
    if (trigger?.type === "schedule" && trigger.config?.cronExpression) {
      try {
        const interval = CronExpressionParser.parse(
          trigger.config.cronExpression,
        );
        nextRunAt = interval.next().toISOString() || undefined;
      } catch {
        return api.badRequest("Invalid cron expression");
      }
    }

    const workflow = await workflowStore.createWorkflow({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      name,
      description,
      trigger,
      output,
      outputPosition,
      steps,
      nextRunAt,
    });

    return api.created(workflow);
  } catch (error) {
    return handleError(error, "Create workflow");
  }
}
