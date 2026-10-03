import { NextRequest } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { api, handleError } from "@/lib/api-utils";
import { nextRunAtFor } from "@/lib/workflow/schedule";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

export async function GET(request: NextRequest) {
  try {
    if (!workflowStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    const cronSecret = env.CRON_SECRET;

    if (!cronSecret) {
      return api.unauthorized("Cron secret not configured");
    }

    const secretsMatch =
      token.length === cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret));

    if (!secretsMatch) {
      return api.unauthorized("Invalid cron secret");
    }

    const now = new Date();
    const nowISO = now.toISOString();
    // One clock read for the whole tick: `nowISO` is both the due-window bound
    // and the `lastRunAt` the claim writes, so they cannot disagree by a
    // millisecond.
    const scheduledWorkflows =
      await workflowStore.getScheduledRichWorkflows(nowISO);
    const triggeredWorkflowIds: string[] = [];

    for (const workflow of scheduledWorkflows) {
      const cronExpression = workflow.trigger?.config?.cronExpression;
      if (!cronExpression) continue;

      let nextRunAt: string;
      try {
        // `nextRunAtFor` is the write path's own helper (Task 11, already
        // landed). Reusing it here keeps one definition of "the next fire
        // time" instead of a third inline copy of the same parse.
        const computed = nextRunAtFor(workflow.trigger, now);
        if (!computed) continue;
        nextRunAt = computed;
      } catch {
        logger.error(
          `Invalid cron expression for workflow ${workflow.id}: ${cronExpression}`,
        );
        continue;
      }

      // Claim before running. The store filters on the `updatedAt` this read
      // observed, so of two runners on the same tick exactly one is told it won
      // — and the loser skips the run rather than duplicating it.
      const claimed = await workflowStore.claimRichWorkflowSchedule(
        workflow.id,
        workflow.userId,
        nowISO,
        nextRunAt,
      );
      if (!claimed) continue;

      logger.info(`Triggering scheduled workflow ${workflow.id}`);
      triggeredWorkflowIds.push(workflow.id);

      const eventGenerator = workflowExecutionService.executeRichWorkflow({
        workflow,
        query: { message: "Triggered via scheduled cron job" },
      });

      // Fire and forget: the run writes its own execution record, and the cron
      // caller must not wait on a model.
      void (async () => {
        try {
          // The binding itself is unused — draining the generator is what runs
          // the workflow. Keep this disable: `no-unused-vars` comes from
          // `eslint-config-next/typescript` and does **not** ignore an
          // underscore prefix, so without it `pnpm lint` fails. The code being
          // replaced carries the same comment for the same reason.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _event of eventGenerator) {
            // Draining the generator is what runs the workflow.
          }
        } catch (error) {
          logger.error(
            { err: error },
            `Scheduled workflow execution error for ${workflow.id}`,
          );
        }
      })();
    }

    return api.success({
      success: true,
      message: `Evaluated ${scheduledWorkflows.length} scheduled workflows. Triggered ${triggeredWorkflowIds.length}.`,
      triggeredWorkflowIds,
    });
  } catch (error) {
    return handleError(error, "Cron execution");
  }
}
