import { CronExpressionParser } from "cron-parser";
import type { WorkflowTrigger } from "@/lib/types";

/**
 * When a schedule trigger fires next, or null when the workflow is not on a
 * schedule at all.
 *
 * Throws when the expression cannot be parsed, so the caller can answer with a
 * 400 instead of storing a workflow that will never come due. Returning null for
 * "not on a schedule" and throwing for "on a schedule but unusable" are
 * deliberately different outcomes.
 */
export function nextRunAtFor(
  trigger: WorkflowTrigger | undefined,
  from: Date,
): string | null {
  if (trigger?.type !== "schedule") return null;

  const expression = trigger.config?.cronExpression;
  if (!expression) return null;

  const interval = CronExpressionParser.parse(expression, { currentDate: from });
  return interval.next().toISOString();
}
