import type { ZodType } from "zod";
import type {
  Schedule,
  ScheduleRun,
  TriggerTarget,
  TriggerTargetType,
} from "@/lib/types";

export type TargetValidation =
  | { ok: true; name: string }
  | { ok: false; code: "target_not_found" | "unauthorized" | "invalid_target" };

/** A run plus the schedule it came from — what an executor needs to do its work. */
export type ClaimedRun = ScheduleRun & { schedule: Schedule };

export type TriggerResult = { resultRef?: ScheduleRun["resultRef"] };

/**
 * What one kind of target must provide.
 *
 * `validate` is a security boundary rather than a convenience. The accessors it
 * reaches are inconsistently owned — `getTool(toolId)` takes no `userId` at all,
 * and `getRichWorkflow(id)` takes none either — so a schedule pointing at
 * another user's agent would otherwise run it. Ownership is checked here because
 * this is the only layer that has both the caller and the target in hand.
 */
export interface TriggerExecutor {
  type: TriggerTargetType;
  /** Validates `Schedule.input`; also drives the phase-2 form. */
  inputSchema: ZodType;
  validate(userId: string, targetId: string): Promise<TargetValidation>;
  describe(userId: string, targetId: string): Promise<{ name: string } | null>;
  execute(run: ClaimedRun, signal?: AbortSignal): Promise<TriggerResult>;
}

/**
 * Registered executors by type.
 *
 * Phase 1 registers `workflow` only. `agent` and `tool` are absent rather than
 * stubbed: `getExecutor` returning `null` is what makes a schedule targeting
 * them answer `invalid_target` at save time instead of failing at 3am.
 */
const EXECUTORS = new Map<TriggerTargetType, TriggerExecutor>();

export function registerExecutor(executor: TriggerExecutor): void {
  EXECUTORS.set(executor.type, executor);
}

export function getExecutor(type: TriggerTargetType): TriggerExecutor | null {
  return EXECUTORS.get(type) ?? null;
}

export async function validateTarget(
  userId: string,
  target: TriggerTarget,
): Promise<TargetValidation> {
  const executor = getExecutor(target.type);
  if (!executor) return { ok: false, code: "invalid_target" };
  return executor.validate(userId, target.id);
}
