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

export function validateCadence(cadence: ScheduleCadence): CadenceValidation {
  if (cadence.kind === "once") {
    const runAt = new Date(cadence.runAt);
    if (Number.isNaN(runAt.getTime())) {
      return { ok: false, message: "runAt must be an ISO 8601 date." };
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
      currentDate: new Date(),
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
