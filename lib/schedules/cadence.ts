import { CronExpressionParser } from "cron-parser";
import type { ScheduleCadence } from "@/lib/types";

export type CadenceValidation = { ok: true } | { ok: false; message: string };

/**
 * Whether a zone identifier is one `Intl` accepts.
 *
 * A membership test against `Intl.supportedValuesOf("timeZone")` would reject
 * aliases that `Intl` resolves happily (`Asia/Calcutta`), so this asks the
 * runtime to use the zone and catches its refusal. That is the same question the
 * cron parser will ask later, which is the point.
 */
function isRealTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function nextFrom(cadence: ScheduleCadence, from: Date): Date | null {
  if (cadence.kind === "once") {
    const runAt = new Date(cadence.runAt);
    return runAt.getTime() > from.getTime() ? runAt : null;
  }

  const interval = CronExpressionParser.parse(cadence.expression, {
    currentDate: from,
    tz: cadence.timezone,
  });
  return interval.next().toDate();
}

/**
 * Whether a cadence can fire at all.
 *
 * `from` is a parameter rather than a read of the clock for the same reason
 * `nextOccurrence` takes one: the answer is about a relationship between the
 * cadence and an instant, and a caller computing a save-time preview wants both
 * halves to agree on which instant they are asking about.
 *
 * A `once` cadence in the past is rejected, and that is the whole reason the
 * reference instant is needed here. Such a cadence stores `nextRunAt: null`, and
 * the due query bounds that field with an ISO *string* — which never matches a
 * BSON `null`, because MongoDB's comparison is type-bracketed. The schedule
 * would sit `enabled: true` and never fire, which is precisely the silent
 * never-fires failure that the cron branch below exists to prevent, for the
 * other cadence kind.
 */
export function validateCadence(
  cadence: ScheduleCadence,
  from: Date = new Date(),
): CadenceValidation {
  if (cadence.kind === "once") {
    const runAt = new Date(cadence.runAt);
    if (Number.isNaN(runAt.getTime())) {
      return { ok: false, message: "runAt must be an ISO 8601 date." };
    }
    if (runAt.getTime() <= from.getTime()) {
      return {
        ok: false,
        message: "A one-off schedule must be set for a time in the future.",
      };
    }
    return { ok: true };
  }

  if (!isRealTimezone(cadence.timezone)) {
    return {
      ok: false,
      message: `${cadence.timezone} is not a recognized IANA timezone.`,
    };
  }

  try {
    CronExpressionParser.parse(cadence.expression, {
      currentDate: from,
      tz: cadence.timezone,
    });
  } catch (error) {
    // `cron-parser` rejects an expression that can never fire right here rather
    // than handing back an iterator with no next occurrence — `0 0 30 2 *`
    // throws "Invalid explicit day of month definition", and a valid expression
    // searches arbitrarily far ahead rather than running out. So there is no
    // separate "parsed but dead" case to detect afterwards, and the parse
    // rejection is where a never-firing schedule has to be caught. The message
    // says "never fires" either way, because a schedule that is stored and then
    // silently skipped forever is the failure being prevented; the parser's own
    // reason follows, so a typo is still legible.
    const reason = error instanceof Error ? error.message : "invalid expression";
    return { ok: false, message: `That cron expression never fires: ${reason}` };
  }

  return { ok: true };
}

export function nextOccurrence(
  cadence: ScheduleCadence,
  from: Date,
): Date | null {
  return nextFrom(cadence, from);
}

/**
 * The claim's arithmetic for one due schedule: where `nextRunAt` goes, and
 * whether the cadence is spent.
 *
 * This is a value rather than a throw because the store claims *every* due
 * schedule in one loop, and a single stored cadence that no longer computes — a
 * hand-edited document, a zone the parser rejects — must not take the loop down
 * with it. Thrown, it would reject `claimDueSchedules`, reject `runTick`, and
 * turn the tick endpoint into a 500 on every request for every tenant until
 * somebody fixed the one document. Returned, the store can disable that schedule
 * and carry on with the rest, which is what the deleted `/api/cron` route did
 * with its own per-item `try`/`catch`.
 *
 * It lives here, not in the store, for the same reason `reaperOutcome` lives in
 * `retry.ts`: the store is `"server-only"` and I/O-bound, so the decision has to
 * be somewhere a unit test can reach it.
 */
export function nextClaim(
  cadence: ScheduleCadence,
  now: Date,
): { ok: true; nextRunAt: string | null; disable: boolean } | { ok: false; message: string } {
  try {
    if (cadence.kind === "once") {
      return { ok: true, nextRunAt: null, disable: true };
    }
    const next = nextFrom(cadence, now);
    return {
      ok: true,
      nextRunAt: next ? next.toISOString() : null,
      disable: false,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "uncomputable cadence",
    };
  }
}

export function nextOccurrences(
  cadence: ScheduleCadence,
  from: Date,
  count: number,
): Date[] {
  if (count <= 0) return [];

  if (cadence.kind === "once") {
    const only = nextFrom(cadence, from);
    return only ? [only] : [];
  }

  const interval = CronExpressionParser.parse(cadence.expression, {
    currentDate: from,
    tz: cadence.timezone,
  });

  const out: Date[] = [];
  while (out.length < count && interval.hasNext()) {
    out.push(interval.next().toDate());
  }
  return out;
}

/** Two digits, so `9` renders `09` and a preview column lines up. */
const pad = (n: number) => String(n).padStart(2, "0");

export function describeCadence(cadence: ScheduleCadence): string {
  if (cadence.kind === "once") {
    return `Once on ${new Date(cadence.runAt).toISOString()}`;
  }

  const field = cadence.expression.trim().split(/\s+/);
  const [minute, hour, , , dayOfWeek] = field;

  if (
    field.length === 5 &&
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfWeek === "1-5"
  ) {
    return `Weekdays at ${pad(Number(hour))}:${pad(Number(minute))}, ${cadence.timezone}`;
  }

  if (field.length === 5 && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return `Daily at ${pad(Number(hour))}:${pad(Number(minute))}, ${cadence.timezone}`;
  }

  return `${cadence.expression} (${cadence.timezone})`;
}
