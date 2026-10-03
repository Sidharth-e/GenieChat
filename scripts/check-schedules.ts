import { MongoClient, type Collection } from "mongodb";
import { generateId } from "@/lib/utils";
import { nextOccurrence } from "@/lib/schedules/cadence";
import { reaperOutcome } from "@/lib/schedules/retry";
import { SCHEDULE_RUN_RETENTION_DAYS } from "@/constants/schedules";
import type {
  ScheduleCadence,
  ScheduleRunStatus,
  TriggerTarget,
} from "@/lib/types";

/**
 * Exercises the four scheduling properties that are concurrency properties, and
 * so cannot be unit-tested: a claim that races itself, a lease whose owner died,
 * spent attempts, and an overlap under `skip`.
 *
 * Two deliberate choices, both forced by the module layout:
 *
 * 1. It reads `process.env` directly and builds its own `MongoClient`, for the
 *    reason `setup-mongodb.ts` and `check-storage.ts` document: `lib/config` is
 *    `server-only` and reaches the whole `lib/env.ts` schema, so an unrelated
 *    blank optional var would stop this script from running.
 * 2. It cannot import `ScheduleStore` at all -- the store reaches
 *    `lib/mongodb/client`, which reaches `lib/config` -- so the claim, reaper and
 *    settle queries below are a copy of the store's, not the store itself. That
 *    is a real limitation: this proves the *database* serialises the queries the
 *    store issues, and a change to the store's query shape would leave these
 *    copies asserting the old one. `lib/memory/cypher.ts` exists precisely to
 *    avoid that drift for the memory graph; the schedule store has no such module
 *    yet, and this script is the argument for extracting one if it grows.
 *
 * The claim and reaper queries here are additionally scoped to this run's own
 * `userId`, which the store's are not. That narrows *which* documents are
 * considered and changes nothing about the compare-and-swap being tested -- but
 * without it, running this against a live database would claim and enqueue runs
 * for other tenants' genuinely-due schedules.
 */

const SCHEDULES = "schedules";
const RUNS = "schedule_runs";

/** Scopes every document this run touches, so cleanup is exact and cannot reach real data. */
const TEST_USER = `check-schedules-${Date.now()}`;

const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const PAST_ISO = new Date(NOW.getTime() - 60_000).toISOString();
const CLAIM_LIMIT = 10;

interface ScheduleRow {
  _id: string;
  id: string;
  userId: string;
  name: string;
  target: TriggerTarget;
  input: unknown;
  cadence: ScheduleCadence;
  enabled: boolean;
  overlapPolicy: "skip" | "allow";
  catchUpPolicy: "skip" | "once";
  maxAttempts: number;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastRunStatus?: ScheduleRunStatus;
  skippedRuns: number;
  createdAt: string;
  updatedAt: string;
}

interface RunRow {
  _id: string;
  id: string;
  scheduleId: string;
  userId: string;
  target: TriggerTarget;
  trigger: "schedule" | "manual";
  scheduledFor: string;
  status: ScheduleRunStatus;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { code: string; message: string; retryable: boolean };
  resultRef?: {
    executionId?: string;
    threadId?: string;
    outputPreview?: string;
  };
  /** A real `Date`, because the TTL index requires one. */
  expiresAt: Date;
  createdAt: string;
  updatedAt: string;
}

/** A due `cron` schedule of this run's own, built so the shape lives in one place. */
function makeScheduleDoc(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  const id = overrides.id ?? overrides._id ?? generateId();
  return {
    userId: TEST_USER,
    name: "check",
    target: { type: "workflow", id: "wf_check" },
    input: {},
    cadence: { kind: "cron", expression: "* * * * *", timezone: "UTC" },
    enabled: true,
    overlapPolicy: "allow",
    catchUpPolicy: "skip",
    maxAttempts: 3,
    nextRunAt: PAST_ISO,
    skippedRuns: 0,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
    // Re-asserted after the spread so `_id` and `id` can never disagree, whichever
    // of the two an override supplied.
    _id: id,
    id,
  };
}

/** A run of this run's own, in whatever state the check under test needs. */
function makeRunDoc(overrides: Partial<RunRow> = {}): RunRow {
  const id = overrides.id ?? overrides._id ?? generateId();
  return {
    scheduleId: "sched_placeholder",
    userId: TEST_USER,
    target: { type: "workflow", id: "wf_check" },
    trigger: "schedule",
    scheduledFor: NOW_ISO,
    status: "pending",
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: NOW_ISO,
    leaseExpiresAt: null,
    expiresAt: new Date(
      NOW.getTime() + SCHEDULE_RUN_RETENTION_DAYS * 86_400_000,
    ),
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
    _id: id,
    id,
  };
}

/**
 * The store's `claimDueSchedules`, scoped to this run's `userId`. The CAS filter
 * is left exactly as the store writes it: `nextRunAt` is the token, and its
 * changing is what makes a second claimer lose.
 */
async function claimDueSchedules(
  schedules: Collection<ScheduleRow>,
  now: Date,
  limit: number,
): Promise<ScheduleRow[]> {
  const nowISO = now.toISOString();
  const candidates = await schedules
    .find({ userId: TEST_USER, enabled: true, nextRunAt: { $lte: nowISO } })
    .sort({ nextRunAt: 1 })
    .limit(limit)
    .toArray();

  const claimed: ScheduleRow[] = [];
  for (const candidate of candidates) {
    const once = candidate.cadence.kind === "once";
    const next = once ? null : nextOccurrence(candidate.cadence, now);

    const pre = await schedules.findOneAndUpdate(
      { _id: candidate._id, enabled: true, nextRunAt: candidate.nextRunAt },
      {
        $set: {
          nextRunAt: next ? next.toISOString() : null,
          lastRunAt: nowISO,
          updatedAt: nowISO,
          ...(once ? { enabled: false } : {}),
        },
      },
      { returnDocument: "before" },
    );

    if (pre) claimed.push(pre);
  }
  return claimed;
}

/** The store's `settleRun`, copied because the store cannot be imported here. */
async function settleRun(
  runs: Collection<RunRow>,
  runId: string,
  outcome:
    | { status: "succeeded"; resultRef?: RunRow["resultRef"] }
    | { status: "pending"; nextAttemptAt: string; error: RunRow["error"] }
    | { status: "failed"; error: RunRow["error"] },
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const started = await runs.findOne(
    { _id: runId },
    { projection: { startedAt: 1 } },
  );

  const fields: Record<string, unknown> = {
    status: outcome.status,
    finishedAt,
    updatedAt: finishedAt,
    leaseExpiresAt: null,
  };

  if (started?.startedAt) {
    fields.durationMs =
      Date.parse(finishedAt) - Date.parse(started.startedAt);
  }
  if (outcome.status === "pending") {
    fields.nextAttemptAt = outcome.nextAttemptAt;
    fields.error = outcome.error;
  } else if (outcome.status === "failed") {
    fields.error = outcome.error;
  } else if (outcome.resultRef) {
    fields.resultRef = outcome.resultRef;
  }

  await runs.updateOne({ _id: runId }, { $set: fields });
}

/** The store's `reapExpiredLeases`, scoped to this run's `userId`. */
async function reapExpiredLeases(
  runs: Collection<RunRow>,
  now: Date,
): Promise<number> {
  const stale = await runs
    .find({
      userId: TEST_USER,
      status: "running",
      leaseExpiresAt: { $lte: now.toISOString() },
    })
    .toArray();

  for (const doc of stale) {
    await settleRun(runs, doc._id, reaperOutcome(doc, now));
  }
  return stale.length;
}

/** The store's `hasOpenRun`. */
async function hasOpenRun(
  runs: Collection<RunRow>,
  scheduleId: string,
): Promise<boolean> {
  const count = await runs.countDocuments(
    { scheduleId, status: { $in: ["pending", "running"] } },
    { limit: 1 },
  );
  return count > 0;
}

/** The store's `markSkipped`. */
async function markSkipped(
  schedules: Collection<ScheduleRow>,
  scheduleId: string,
  nowISO: string,
): Promise<void> {
  await schedules.updateOne(
    { _id: scheduleId },
    { $inc: { skippedRuns: 1 }, $set: { updatedAt: nowISO } },
  );
}

/**
 * Two ticks racing one due schedule produce exactly one run — the property the
 * whole claim design exists for, and the one that cannot be asserted without a
 * database that actually serialises the two writes.
 */
async function racesToSingleRun(
  schedules: Collection<ScheduleRow>,
  runs: Collection<RunRow>,
): Promise<boolean> {
  const scheduleId = generateId();
  await schedules.insertOne(
    makeScheduleDoc({ _id: scheduleId, overlapPolicy: "allow" }),
  );

  // Both claims read the same due candidate and race the same CAS. Exactly one
  // may win; a second pre-image means the token moved under the loser's feet
  // without it noticing.
  const [first, second] = await Promise.all([
    claimDueSchedules(schedules, NOW, CLAIM_LIMIT),
    claimDueSchedules(schedules, NOW, CLAIM_LIMIT),
  ]);

  const claims = [...first, ...second].filter((s) => s._id === scheduleId);
  // One run row per winning claim, exactly as the tick's phase 3 writes them.
  for (const claim of claims) {
    await runs.insertOne(
      makeRunDoc({
        scheduleId,
        scheduledFor: claim.nextRunAt ?? NOW_ISO,
        status: "pending",
      }),
    );
  }

  const inserted = await runs.countDocuments({ scheduleId });
  return claims.length === 1 && inserted === 1;
}

/**
 * A run whose process died is retried, not stuck `running` — the property that
 * makes a killed serverless invocation survivable.
 */
async function reapsExpiredLease(runs: Collection<RunRow>): Promise<boolean> {
  const runId = generateId();
  await runs.insertOne(
    makeRunDoc({
      _id: runId,
      status: "running",
      attempt: 1,
      nextAttemptAt: null,
      leaseExpiresAt: PAST_ISO,
      startedAt: new Date(NOW.getTime() - 120_000).toISOString(),
    }),
  );

  const reaped = await reapExpiredLeases(runs, NOW);
  const after = await runs.findOne({ _id: runId });

  return (
    reaped >= 1 &&
    after?.status === "pending" &&
    after.leaseExpiresAt === null &&
    typeof after.nextAttemptAt === "string" &&
    after.nextAttemptAt > NOW_ISO
  );
}

/** Spent attempts land on `failed` rather than being handed back forever. */
async function exhaustsToFailed(runs: Collection<RunRow>): Promise<boolean> {
  const runId = generateId();
  await runs.insertOne(
    makeRunDoc({
      _id: runId,
      status: "running",
      attempt: 3,
      maxAttempts: 3,
      nextAttemptAt: null,
      leaseExpiresAt: PAST_ISO,
      startedAt: new Date(NOW.getTime() - 120_000).toISOString(),
    }),
  );

  await reapExpiredLeases(runs, NOW);
  const after = await runs.findOne({ _id: runId });

  return after?.status === "failed" && after.error?.code === "lease_expired";
}

/**
 * An overlap under `skip` inserts no row and counts instead — the bound that
 * keeps a fast-firing schedule with a long run from growing history without end.
 */
async function skipsOverlap(
  schedules: Collection<ScheduleRow>,
  runs: Collection<RunRow>,
): Promise<boolean> {
  const scheduleId = generateId();
  await schedules.insertOne(
    makeScheduleDoc({ _id: scheduleId, overlapPolicy: "skip" }),
  );
  // The attempt already in flight that makes this occurrence an overlap.
  await runs.insertOne(
    makeRunDoc({ scheduleId, status: "pending", attempt: 1 }),
  );

  const claimed = await claimDueSchedules(schedules, NOW, CLAIM_LIMIT);
  for (const schedule of claimed.filter((s) => s._id === scheduleId)) {
    if (
      schedule.overlapPolicy === "skip" &&
      (await hasOpenRun(runs, schedule.id))
    ) {
      await markSkipped(schedules, schedule.id, NOW_ISO);
    } else {
      await runs.insertOne(makeRunDoc({ scheduleId, status: "pending" }));
    }
  }

  const after = await schedules.findOne({ _id: scheduleId });
  const rows = await runs.countDocuments({ scheduleId });

  return after?.skippedRuns === 1 && rows === 1;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "MONGODB_URI is not set. This script reads it from the environment; the\n" +
        "`schedules:check` pnpm script loads `.env` for you.",
    );
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME ?? "geniechat");
  const schedules = db.collection<ScheduleRow>(SCHEDULES);
  const runs = db.collection<RunRow>(RUNS);

  let failures = 0;
  const report = (name: string, ok: boolean, detail = "") => {
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
    );
    if (!ok) failures += 1;
  };

  try {
    // A missing collection would make every insert below create one and every
    // check pass on a database the subsystem cannot actually run against, so
    // this fails loudly here rather than vacuously succeeding.
    const present = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (c) => c.name,
      ),
    );
    const missing = [SCHEDULES, RUNS].filter((name) => !present.has(name));
    if (missing.length > 0) {
      console.error(
        `Missing collection(s): ${missing.join(", ")}. Run \`pnpm db:setup\` first --` +
          " without them this check would create them itself and pass vacuously.",
      );
      process.exit(1);
    }

    report(
      "two concurrent claims yield one run",
      await racesToSingleRun(schedules, runs),
    );
    report(
      "an expired lease is reaped and retried",
      await reapsExpiredLease(runs),
    );
    report("exhausted attempts land on failed", await exhaustsToFailed(runs));
    report("an overlap under skip inserts no row", await skipsOverlap(schedules, runs));
  } finally {
    // Scoped to TEST_USER, so a live database's own schedules are never touched.
    await schedules.deleteMany({ userId: TEST_USER });
    await runs.deleteMany({ userId: TEST_USER });
    await client.close();
  }

  console.log(
    failures === 0
      ? "\nAll schedule checks passed."
      : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
