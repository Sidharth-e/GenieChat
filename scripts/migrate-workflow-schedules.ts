import { MongoClient } from "mongodb";
import { CronExpressionParser } from "cron-parser";
import { SCHEDULE_DEFAULT_MAX_ATTEMPTS } from "@/constants/schedules";
import { generateId } from "@/lib/utils";

/**
 * Converts the legacy per-workflow cron trigger into a `Schedule` document.
 *
 * Four deliberate choices:
 *
 * 1. It reads `process.env` directly and drives its own `MongoClient`, for the
 *    reason `setup-mongodb.ts` documents in its own header: `lib/config.ts` is
 *    guarded by `server-only`, an alias that does not resolve in a plain `tsx`
 *    process, and it reaches `lib/env.ts`, which validates the whole
 *    environment. `ScheduleStore` is unreachable for the same reason.
 * 2. The timezone is an explicit choice, never inherited. The legacy expression
 *    was parsed with no `tz`, so `cron-parser` used the running process's zone —
 *    UTC for a typical container, and silently wrong anywhere else. There is no
 *    way to recover the intent from the stored row, so the operator states it.
 * 3. It is safe to re-run. The `$unset` at the end removes the `trigger` the
 *    query matches on, so a second run finds nothing; the explicit existence
 *    check below covers the case where a previous run died between its insert
 *    and its update, which would otherwise leave the trigger in place and write
 *    a *second* schedule — firing one workflow twice per occurrence.
 * 4. A row whose expression cannot be parsed is skipped rather than guessed at.
 *    The legacy pulse logged and moved on; a schedule that never fires would be
 *    a worse outcome than a row this script says it left alone.
 *
 * `@/lib/utils` and `@/constants/schedules` are imported directly, as
 * `migrate-memories.ts` already does: neither carries a `server-only` guard.
 * `generateId()` is the house uuidv7, which every `_id` in this database is.
 */

/** The placeholder the legacy pulse passed to every scheduled run. */
const LEGACY_INPUT = { message: "Triggered via scheduled cron job" };

/**
 * The legacy rows this migration reads, typed rather than left as the driver's
 * bare `Document`. Only the fields it touches.
 */
interface LegacyWorkflowRow {
  _id: string;
  userId: string;
  name: string;
  trigger?: { type: string; config?: { cronExpression?: string } };
}

/**
 * The document written to `schedules`.
 *
 * Declared explicitly, as `backfill-chunks.ts` does, because a `_id` in an
 * untyped `Document` resolves to `ObjectId` — and every id in this database is
 * the string `generateId()` produces, so the write would not type-check.
 */
interface ScheduleRow {
  _id: string;
  userId: string;
  name: string;
  target: { type: "workflow"; id: string };
  input: unknown;
  cadence: { kind: "cron"; expression: string; timezone: string };
  enabled: boolean;
  overlapPolicy: "skip" | "allow";
  catchUpPolicy: "skip" | "once";
  maxAttempts: number;
  nextRunAt: string | null;
  skippedRuns: number;
  createdAt: string;
  updatedAt: string;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "MONGODB_URI is not set; `schedules:migrate` loads .env for you.",
    );
    process.exit(1);
  }

  const timezone = process.argv.includes("--timezone")
    ? process.argv[process.argv.indexOf("--timezone") + 1]
    : "UTC";
  console.log(`Interpreting legacy cron expressions in ${timezone}.`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME ?? "geniechat");

  const rows = await db
    .collection<LegacyWorkflowRow>("workflows")
    .find({ "trigger.type": "schedule" })
    .toArray();

  let converted = 0;
  for (const row of rows) {
    const expression = row.trigger?.config?.cronExpression;
    if (!expression) continue;

    // Idempotency, independent of the `$unset` ordering — see note 3 above.
    const existing = await db
      .collection<ScheduleRow>("schedules")
      .findOne({ "target.type": "workflow", "target.id": row._id });
    if (existing) continue;

    let nextRunAt: string | null = null;
    try {
      nextRunAt = CronExpressionParser.parse(expression, {
        currentDate: new Date(),
        tz: timezone,
      })
        .next()
        .toISOString();
    } catch {
      console.warn(`Skipping ${row._id}: unparseable expression ${expression}`);
      continue;
    }

    const nowISO = new Date().toISOString();
    await db.collection<ScheduleRow>("schedules").insertOne({
      _id: generateId(),
      userId: row.userId,
      name: `${row.name} (migrated)`,
      target: { type: "workflow", id: row._id },
      input: LEGACY_INPUT,
      cadence: { kind: "cron", expression, timezone },
      enabled: true,
      overlapPolicy: "skip",
      catchUpPolicy: "skip",
      maxAttempts: SCHEDULE_DEFAULT_MAX_ATTEMPTS,
      nextRunAt,
      skippedRuns: 0,
      createdAt: nowISO,
      updatedAt: nowISO,
    });

    // Required, not tidy-up: with the `schedule` variant removed from
    // `WorkflowTrigger`, a stored row still carrying it does not conform to its
    // own schema.
    await db
      .collection<LegacyWorkflowRow>("workflows")
      .updateOne({ _id: row._id }, { $unset: { trigger: "", nextRunAt: "" } });
    converted += 1;
  }

  console.log(`Converted ${converted} of ${rows.length} scheduled workflows.`);
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
