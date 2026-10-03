import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { workflowExecutionService } from "@/lib/langchain/workflow-execution-service";
import { workflowInputSchema } from "@/lib/schedules/input-schemas";
import {
  registerExecutor,
  type ClaimedRun,
  type TargetValidation,
  type TriggerResult,
} from "@/lib/schedules/registry";

/**
 * The schema lives in `input-schemas.ts` rather than here, because the editor
 * builds its input form from the same object and cannot import this module --
 * this one reaches the store and the model, which do not exist on the client.
 */
const inputSchema = workflowInputSchema;

const workflowStore = new WorkflowStore();

export const workflowExecutor = {
  type: "workflow" as const,
  inputSchema,

  async validate(userId: string, targetId: string): Promise<TargetValidation> {
    const workflow = await workflowStore.getRichWorkflow(targetId);
    // The accessor takes no `userId`, so this comparison is the ownership
    // check rather than defence in depth.
    if (!workflow) return { ok: false, code: "target_not_found" };
    if (workflow.userId !== userId) return { ok: false, code: "unauthorized" };
    return { ok: true, name: workflow.name };
  },

  async describe(userId: string, targetId: string) {
    const workflow = await workflowStore.getRichWorkflow(targetId);
    if (!workflow || workflow.userId !== userId) return null;
    return { name: workflow.name };
  },

  async execute(run: ClaimedRun): Promise<TriggerResult> {
    // Checked here rather than left to the scheduler, which by contract never
    // inspects `input`. A malformed value is terminal: `invalid_input` is in
    // `SCHEDULE_TERMINAL_ERROR_CODES`, so the run fails at once instead of
    // burning its remaining attempts against input that cannot become valid.
    const parsed = inputSchema.safeParse(run.schedule.input);
    if (!parsed.success) {
      throw Object.assign(new Error("The schedule's input is not valid"), {
        code: "invalid_input",
      });
    }

    const workflow = await workflowStore.getRichWorkflow(run.target.id);
    if (!workflow) {
      throw Object.assign(new Error("Workflow no longer exists"), {
        code: "target_not_found",
      });
    }

    const events = workflowExecutionService.executeRichWorkflow({
      workflow,
      query: parsed.data,
    });

    let executionId: string | undefined;
    // Draining the generator is what runs the workflow. The last event carries
    // the execution id that the run record links to.
    for await (const event of events) {
      if (event.executionId) executionId = event.executionId;
      if (event.eventType === "WORKFLOW_END" && event.isOk === false) {
        throw Object.assign(new Error(event.error ?? "Workflow failed"), {
          code: "workflow_error",
        });
      }
    }

    return executionId ? { resultRef: { executionId } } : {};
  },
};

registerExecutor(workflowExecutor);
