import { z } from "zod";
import type { TriggerTargetType } from "@/lib/types";

/**
 * The input schema for each target kind, kept apart from the executors.
 *
 * Both the executor and the editor need the same schema, and only one of them can
 * have the executor: `lib/schedules/executors.ts` imports the `"server-only"`
 * stores and the model, so a client component importing it would not build, and a
 * schema cannot be passed across the RSC boundary because it is an object with
 * methods. This module imports nothing but `zod`, which is what lets the editor
 * and the executor read one declaration instead of two that drift -- a form that
 * accepted an input the executor then rejected is exactly that drift.
 *
 * `tool` has no entry on purpose: it is a kind `TriggerTargetType` admits and an
 * executor that arrives in phase 3. `targetInputSchema` answering `null` for it is
 * what makes the editor say the target cannot be scheduled rather than render an
 * empty form.
 *
 * The `.describe()` on each field is not documentation: `buildInputForm` reads it
 * as the field's label, so removing one removes the label with it.
 */
export const workflowInputSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe("What to send the workflow. Workflows that read no input ignore it."),
});

export const agentInputSchema = z.object({
  message: z.string().min(1).describe("What to send the agent."),
});

export const TARGET_INPUT_SCHEMAS: Partial<Record<TriggerTargetType, z.ZodType>> = {
  workflow: workflowInputSchema,
  agent: agentInputSchema,
};

export function targetInputSchema(type: TriggerTargetType): z.ZodType | null {
  return TARGET_INPUT_SCHEMAS[type] ?? null;
}
