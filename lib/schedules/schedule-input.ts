import {
  SCHEDULE_CATCH_UP_POLICIES,
  SCHEDULE_DEFAULT_MAX_ATTEMPTS,
  SCHEDULE_MAX_ATTEMPTS,
  SCHEDULE_OVERLAP_POLICIES,
  SCHEDULE_TARGET_TYPES,
} from "@/constants/schedules";
import { nextRunAtISO, validateCadence } from "@/lib/schedules/cadence";
import type { TargetValidation } from "@/lib/schedules/registry";
import type {
  Schedule,
  ScheduleCadence,
  TriggerTarget,
  TriggerTargetType,
} from "@/lib/types";

/**
 * The mutable half of a `Schedule` -- everything a create or an update may set.
 *
 * `id`, `userId`, the bookkeeping fields (`skippedRuns`, `lastRunAt`,
 * `lastRunStatus`) and the timestamps are deliberately absent: they belong to the
 * store, and a route that could set them would be a route that could rewrite
 * another user's ownership or forge a last-run status.
 */
export interface ScheduleDraft {
  name: string;
  description?: string;
  target: TriggerTarget;
  input: unknown;
  cadence: ScheduleCadence;
  enabled: boolean;
  overlapPolicy: Schedule["overlapPolicy"];
  catchUpPolicy: Schedule["catchUpPolicy"];
  maxAttempts: number;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

const fail = (message: string): ParseResult<never> => ({ ok: false, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * A `name` that is present and carries something. Shared by create and patch
 * because the rule is the same; a patch's absence is handled by its caller, not
 * here, so this only ever sees a value that was supplied.
 */
function parseName(value: unknown): ParseResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return fail("Give the schedule a name.");
  }
  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    return fail(`A name can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return { ok: true, value: name };
}

function parseDescription(value: unknown): ParseResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return fail("A description must be text.");
  const description = value.trim();
  if (!description) return { ok: true, value: undefined };
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return fail(`A description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  return { ok: true, value: description };
}

function parseTarget(value: unknown): ParseResult<TriggerTarget> {
  if (!isRecord(value)) return fail("Choose what this schedule should run.");
  const { type, id } = value;
  if (!isMember(SCHEDULE_TARGET_TYPES, type)) {
    return fail("That is not something a schedule can run.");
  }
  if (typeof id !== "string" || !id) {
    return fail("Choose what this schedule should run.");
  }
  return { ok: true, value: { type: type as TriggerTargetType, id } };
}

/**
 * A cadence from a request body.
 *
 * The shape is checked here and the *meaning* is checked by `validateCadence`,
 * which is the same call the editor's preview makes -- so a cadence the preview
 * shows as runnable cannot be rejected here, and the reverse.
 */
function parseCadence(value: unknown, now: Date): ParseResult<ScheduleCadence> {
  if (!isRecord(value)) return fail("Choose when this schedule should run.");

  let cadence: ScheduleCadence;
  if (value.kind === "once") {
    if (typeof value.runAt !== "string") {
      return fail("A one-off schedule needs a date and time.");
    }
    cadence = { kind: "once", runAt: value.runAt };
  } else if (value.kind === "cron") {
    if (typeof value.expression !== "string" || typeof value.timezone !== "string") {
      return fail("A repeating schedule needs an expression and a timezone.");
    }
    cadence = {
      kind: "cron",
      expression: value.expression,
      timezone: value.timezone,
    };
  } else {
    return fail("Choose when this schedule should run.");
  }

  const valid = validateCadence(cadence, now);
  return valid.ok ? { ok: true, value: cadence } : fail(valid.message);
}

/**
 * `maxAttempts`, bounded at both ends.
 *
 * The lower bound is not cosmetic: the tick reads
 * `schedule.maxAttempts || SCHEDULE_DEFAULT_MAX_ATTEMPTS`, so a stored `0` is
 * falsy and silently becomes 3. Rejecting it here is what keeps the stored value
 * and the executed value the same number.
 */
function parseMaxAttempts(value: unknown): ParseResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fail("Attempts must be a whole number.");
  }
  if (value < 1 || value > SCHEDULE_MAX_ATTEMPTS) {
    return fail(`Attempts must be between 1 and ${SCHEDULE_MAX_ATTEMPTS}.`);
  }
  return { ok: true, value };
}

function parseBoolean(value: unknown, field: string): ParseResult<boolean> {
  if (typeof value !== "boolean") return fail(`${field} must be true or false.`);
  return { ok: true, value };
}

/** First failure wins, so a caller gets one message rather than a list. */
function firstFailure(
  results: ParseResult<unknown>[],
): ParseResult<never> | null {
  for (const result of results) if (!result.ok) return result;
  return null;
}

export function parseScheduleDraft(
  body: unknown,
  now: Date,
): ParseResult<ScheduleDraft> {
  if (!isRecord(body)) return fail("Expected a JSON object.");

  const name = parseName(body.name);
  const description = parseDescription(body.description);
  const target = parseTarget(body.target);
  const cadence = parseCadence(body.cadence, now);
  const failure = firstFailure([name, description, target, cadence]);
  if (failure) return failure;
  if (!name.ok || !description.ok || !target.ok || !cadence.ok) {
    // Unreachable: the helper above already reported the first failure. Kept as
    // a narrowing aid so the compiler accepts the reads below.
    return fail("Invalid schedule.");
  }

  const enabled =
    body.enabled === undefined
      ? ({ ok: true, value: true } as const)
      : parseBoolean(body.enabled, "Enabled");

  const overlapPolicy =
    body.overlapPolicy === undefined
      ? ({ ok: true, value: "skip" } as const)
      : isMember(SCHEDULE_OVERLAP_POLICIES, body.overlapPolicy)
        ? ({ ok: true, value: body.overlapPolicy } as const)
        : fail("That is not an overlap policy.");

  const catchUpPolicy =
    body.catchUpPolicy === undefined
      ? ({ ok: true, value: "skip" } as const)
      : isMember(SCHEDULE_CATCH_UP_POLICIES, body.catchUpPolicy)
        ? ({ ok: true, value: body.catchUpPolicy } as const)
        : fail("That is not a catch-up policy.");

  const maxAttempts =
    body.maxAttempts === undefined
      ? ({ ok: true, value: SCHEDULE_DEFAULT_MAX_ATTEMPTS } as const)
      : parseMaxAttempts(body.maxAttempts);

  const tailFailure = firstFailure([
    enabled,
    overlapPolicy,
    catchUpPolicy,
    maxAttempts,
  ]);
  if (tailFailure) return tailFailure;
  if (!enabled.ok || !overlapPolicy.ok || !catchUpPolicy.ok || !maxAttempts.ok) {
    return fail("Invalid schedule.");
  }

  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      target: target.value,
      input: body.input === undefined ? {} : body.input,
      cadence: cadence.value,
      enabled: enabled.value,
      overlapPolicy: overlapPolicy.value,
      catchUpPolicy: catchUpPolicy.value,
      maxAttempts: maxAttempts.value,
    },
  };
}

/**
 * A patch, field by field.
 *
 * Every field is optional and an absent one is *absent from the result*, not
 * defaulted -- which is the whole difference from `parseScheduleDraft`. A patch
 * of `{ enabled: false }` that came back carrying `overlapPolicy: "skip"` would
 * silently reset a schedule configured with `allow` on every pause.
 *
 * An explicit `undefined` is rejected rather than treated as absent, because
 * `{ "name": undefined }` serialised through JSON and a `PATCH` body built by
 * spreading state are both ways for a field to arrive meaning "erase this", and
 * silently doing nothing is the worse of the two surprises.
 */
export function parseSchedulePatch(
  body: unknown,
  now: Date,
): ParseResult<Partial<ScheduleDraft>> {
  if (!isRecord(body)) return fail("Expected a JSON object.");

  const patch: Partial<ScheduleDraft> = {};

  const fields = [
    "name",
    "description",
    "target",
    "input",
    "cadence",
    "enabled",
    "overlapPolicy",
    "catchUpPolicy",
    "maxAttempts",
  ] as const;

  for (const field of fields) {
    if (field in body && body[field] === undefined) {
      return fail(`${field} cannot be set to undefined.`);
    }
  }

  if ("name" in body) {
    const name = parseName(body.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if ("description" in body) {
    const description = parseDescription(body.description);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if ("target" in body) {
    const target = parseTarget(body.target);
    if (!target.ok) return target;
    patch.target = target.value;
  }
  if ("input" in body) patch.input = body.input;
  if ("cadence" in body) {
    const cadence = parseCadence(body.cadence, now);
    if (!cadence.ok) return cadence;
    patch.cadence = cadence.value;
  }
  if ("enabled" in body) {
    const enabled = parseBoolean(body.enabled, "Enabled");
    if (!enabled.ok) return enabled;
    patch.enabled = enabled.value;
  }
  if ("overlapPolicy" in body) {
    if (!isMember(SCHEDULE_OVERLAP_POLICIES, body.overlapPolicy)) {
      return fail("That is not an overlap policy.");
    }
    patch.overlapPolicy = body.overlapPolicy;
  }
  if ("catchUpPolicy" in body) {
    if (!isMember(SCHEDULE_CATCH_UP_POLICIES, body.catchUpPolicy)) {
      return fail("That is not a catch-up policy.");
    }
    patch.catchUpPolicy = body.catchUpPolicy;
  }
  if ("maxAttempts" in body) {
    const maxAttempts = parseMaxAttempts(body.maxAttempts);
    if (!maxAttempts.ok) return maxAttempts;
    patch.maxAttempts = maxAttempts.value;
  }

  return { ok: true, value: patch };
}

/**
 * Whether a patch moves the schedule's `nextRunAt`, and to what.
 *
 * Two cases move it, and they are moved for different reasons:
 *
 * - **The cadence changed.** The stored instant is arithmetic over the old
 *   cadence, so it is arithmetic over the wrong thing the moment the cadence
 *   does.
 * - **A paused schedule was resumed.** Here the stored instant is very likely in
 *   the past -- that is what pausing a schedule for a week does -- and the due
 *   query bounds `nextRunAt` with an ISO string, so an unchanged past value fires
 *   the instant the switch flips. It is recomputed from `now`, which is the same
 *   rule the tick's own claim uses: the next occurrence is computed, never
 *   accumulated.
 *
 * Everything else leaves it alone, including `{ enabled: true }` on a schedule
 * that was never paused -- that is a save, not a resume, and recomputing there
 * would shift a schedule whose next run is two minutes away.
 */
export function nextRunAtAfterPatch(
  now: Date,
  current: Schedule,
  patch: Partial<ScheduleDraft>,
): { update: boolean; nextRunAt: string | null } {
  const cadence = patch.cadence ?? current.cadence;
  const resuming = patch.enabled === true && !current.enabled;
  if (patch.cadence === undefined && !resuming) {
    return { update: false, nextRunAt: null };
  }

  return { update: true, nextRunAt: nextRunAtISO(cadence, now) };
}

/**
 * The user-facing sentence for a `TargetValidation` failure.
 *
 * A distinct sentence per code rather than one generic message, because the three
 * are different problems: the first is a target that was deleted, the second is
 * someone else's, and the third is something the scheduler cannot run at all --
 * and the third is what the *create* route shows when a target type has no
 * executor registered.
 */
export function describeTargetError(
  code: Extract<TargetValidation, { ok: false }>["code"],
): string {
  switch (code) {
    case "target_not_found":
      return "That target no longer exists.";
    case "unauthorized":
      return "You do not have access to that target.";
    case "invalid_target":
      return "That is not something a schedule can run yet.";
  }
}
