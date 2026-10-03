import "server-only";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { agentInputSchema } from "@/lib/schedules/input-schemas";
import {
  registerExecutor,
  type TargetValidation,
  type TriggerExecutor,
} from "@/lib/schedules/registry";
import { runAgentTarget } from "@/lib/schedules/run-agent";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;

/** A concrete schema, not the interface's `ZodType`: `safeParse` on `ZodType` yields `unknown`. */
const inputSchema = agentInputSchema;

/**
 * Ownership, for an accessor that cannot enforce it.
 *
 * `getAgent(agentId, userId?)` ignores its second argument -- `_id` is a globally
 * unique uuidv7, so the read is by id alone. That makes this comparison the only
 * ownership check on an agent target, which is why `validate` is part of the
 * executor interface rather than optional: a schedule pointing at another user's
 * agent would otherwise run it against their credentials and their quota.
 */
async function validateAgent(
  userId: string,
  agentId: string,
): Promise<TargetValidation> {
  if (!agentStore) return { ok: false, code: "target_not_found" };
  const agent = await agentStore.getAgent(agentId);
  if (!agent) return { ok: false, code: "target_not_found" };
  if (agent.userId !== userId) return { ok: false, code: "unauthorized" };
  return { ok: true, name: agent.name };
}

export const agentExecutor: TriggerExecutor = {
  type: "agent",

  // From `input-schemas.ts`, not declared here: the editor reads the same object.
  inputSchema,

  validate: validateAgent,

  async describe(userId: string, agentId: string) {
    const result = await validateAgent(userId, agentId);
    return result.ok ? { name: result.name } : null;
  },

  async execute(run) {
    // `run.schedule.input`, not `run.input`: a `ScheduleRun` is the attempt and
    // carries no input of its own -- the intent lives on the schedule, which the
    // tick loads and attaches.
    const parsed = inputSchema.safeParse(run.schedule.input);
    if (!parsed.success) {
      // `invalid_input` is in `SCHEDULE_TERMINAL_ERROR_CODES`, so this fails on the
      // first attempt. Thrown as a plain `Error` with a `code` rather than a
      // ZodError, because the tick reads `error.code` and a ZodError has none --
      // it would be classified `provider_error`, retried three times, and arrive
      // at the same answer at three times the cost.
      throw Object.assign(
        new Error("This schedule's input is not valid for the agent."),
        { code: "invalid_input" },
      );
    }

    const { threadId, outputPreview } = await runAgentTarget({
      userId: run.userId,
      agentId: run.target.id,
      message: parsed.data.message,
    });

    return { resultRef: { threadId, outputPreview } };
  },
};

registerExecutor(agentExecutor);
