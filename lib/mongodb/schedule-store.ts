import type { Collection } from "mongodb";
import { generateId } from "@/lib/utils";
import {
  getScheduleRunsCollection,
  getSchedulesCollection,
} from "@/lib/mongodb/client";
import {
  dropUndefinedFields,
  hydrateDocument,
  splitNullFields,
  type ScheduleDocument,
  type ScheduleRunDocument,
  type WithMongoId,
} from "@/lib/mongodb/common";
import { logger } from "@/lib/logger";
import { nextClaim } from "@/lib/schedules/cadence";
import { reaperOutcome } from "@/lib/schedules/retry";
import {
  SCHEDULE_LEASE_MS,
  SCHEDULE_RUN_RETENTION_DAYS,
} from "@/constants/schedules";
import type { Schedule, ScheduleRun, TriggerTargetType } from "@/lib/types";

/** What settling one attempt can mean. The three cases the tick has to tell apart. */
export type SettleOutcome =
  | { status: "succeeded"; resultRef?: ScheduleRun["resultRef"] }
  | { status: "pending"; nextAttemptAt: string; error: ScheduleRun["error"] }
  | { status: "failed"; error: ScheduleRun["error"] };

/**
 * What `updateSchedule` may set.
 *
 * Narrower than `Partial<Schedule>` and the narrowing is the whole point:
 * `Partial<Schedule>` admits `userId`, so a route that spread a parsed request
 * body into it could hand a schedule to another tenant. `id`, `userId`,
 * `createdAt` and the bookkeeping fields (`skippedRuns`, `lastRunAt`,
 * `lastRunStatus`) are the store's -- only the tick writes those, through its own
 * statements, and none of them is something a user sets.
 *
 * `nextRunAt` *is* here, because the schedules API recomputes it: resuming a
 * paused schedule and changing a cadence are both writes a user makes.
 */
export type ScheduleUpdate = Partial<
  Pick<
    Schedule,
    | "name"
    | "target"
    | "input"
    | "cadence"
    | "enabled"
    | "overlapPolicy"
    | "catchUpPolicy"
    | "maxAttempts"
    | "nextRunAt"
  >
> & {
  /**
   * `null` clears it. A description is the one optional field a user can remove
   * after setting it, and "remove" has to be tellable apart from "leave alone" --
   * which `undefined` already means, and which the `Pick` above can only say.
   */
  description?: string | null;
};

/** Which schedules a list read wants back. An absent field is not a filter. */
export interface ScheduleListFilter {
  enabled?: boolean;
  targetType?: TriggerTargetType;
  targetId?: string;
}

/**
 * Every read and write the scheduler makes against MongoDB.
 *
 * Two claims live here and they work differently on purpose. A *schedule* is
 * claimed by compare-and-swapping its own `nextRunAt`, because advancing it is
 * part of claiming it — a claim that left `nextRunAt` alone would find the same
 * schedule due again on the very next iteration. A *run* is claimed by flipping
 * `status` to `running`, which is its own token. Both are single
 * `findOneAndUpdate` calls, so a second ticker racing the first loses and skips
 * rather than executing one occurrence twice.
 */
export class ScheduleStore {
  private scheduleCollection: Collection<WithMongoId<ScheduleDocument>>;
  private runCollection: Collection<WithMongoId<ScheduleRunDocument>>;

  constructor() {
    this.scheduleCollection = getSchedulesCollection();
    this.runCollection = getScheduleRunsCollection();
  }

  async createSchedule(
    input: Omit<
      Schedule,
      "id" | "createdAt" | "updatedAt" | "skippedRuns" | "lastRunStatus"
    >,
  ): Promise<Schedule> {
    const now = new Date().toISOString();
    const id = generateId();
    const doc: WithMongoId<ScheduleDocument> = dropUndefinedFields({
      ...input,
      id,
      _id: id,
      skippedRuns: 0,
      createdAt: now,
      updatedAt: now,
    });
    await this.scheduleCollection.insertOne(doc);
    return hydrateDocument(doc);
  }

  /**
   * The caller's schedules, newest activity first.
   *
   * The filter is built by only including the keys that were asked for, because
   * `{ enabled: undefined }` is not an absent filter in MongoDB -- it is a
   * predicate that matches nothing but `undefined`, and the query would return
   * an empty list for a user who has schedules.
   */
  async getSchedules(
    userId: string,
    filter: ScheduleListFilter = {},
  ): Promise<Schedule[]> {
    const docs = await this.scheduleCollection
      .find({
        userId,
        ...(filter.enabled === undefined ? {} : { enabled: filter.enabled }),
        ...(filter.targetType === undefined
          ? {}
          : { "target.type": filter.targetType }),
        ...(filter.targetId === undefined ? {} : { "target.id": filter.targetId }),
      })
      .sort({ updatedAt: -1 })
      .toArray();
    return docs.map(hydrateDocument);
  }

  async getSchedule(id: string, userId: string): Promise<Schedule | null> {
    const doc = await this.scheduleCollection.findOne({ _id: id, userId });
    return doc ? hydrateDocument(doc) : null;
  }

  async updateSchedule(
    id: string,
    userId: string,
    updates: ScheduleUpdate,
  ): Promise<Schedule | null> {
    // A cleared description arrives as `null` and has to leave the document as an
    // absent key rather than a stored null, so the update is split rather than
    // `$set` wholesale.
    const { set, unset } = splitNullFields({
      ...updates,
      updatedAt: new Date().toISOString(),
    });

    const doc = await this.scheduleCollection.findOneAndUpdate(
      { _id: id, userId },
      Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set },
      { returnDocument: "after" },
    );
    return doc ? hydrateDocument(doc) : null;
  }

  /**
   * Removes a schedule and its history.
   *
   * The cascade comes *after* the schedule's own delete, and `deletedCount` is
   * the reason: a `scheduleId` belonging to somebody else matches no schedule for
   * this `userId`, so returning early there is what stops this call from removing
   * another tenant's runs through an id it does not own.
   *
   * A failure in the cascade leaves runs whose schedule is gone. That is the safe
   * direction: every read is scoped by `scheduleId`, so they are unreachable
   * immediately, and the `expiresAt` TTL index collects them within
   * `SCHEDULE_RUN_RETENTION_DAYS` regardless.
   */
  async deleteSchedule(id: string, userId: string): Promise<boolean> {
    const result = await this.scheduleCollection.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) return false;

    await this.runCollection.deleteMany({ scheduleId: id, userId });
    return true;
  }

  /**
   * Claims the due schedules whose `nextRunAt` this call then advances.
   *
   * The returned document is the pre-image, so its `nextRunAt` is the occurrence
   * the caller is now responsible for. The CAS token is that same `nextRunAt`:
   * it changes on every claim, so a concurrent ticker that read the same
   * document finds the value already moved and skips it. Doing this in one
   * statement closes the window a read-then-write pair leaves open, and it is
   * also what makes `catchUpPolicy: "skip"` free — the new value is computed
   * *from* `now`, never by adding a period, so a week of downtime yields one
   * occurrence rather than a week of them.
   */
  async claimDueSchedules(nowISO: string, limit: number): Promise<Schedule[]> {
    const now = new Date(nowISO);
    const candidates = await this.scheduleCollection
      .find({ enabled: true, nextRunAt: { $lte: nowISO } })
      .sort({ nextRunAt: 1 })
      .limit(limit)
      .toArray();

    const claimed: Schedule[] = [];
    for (const candidate of candidates) {
      // Per-item, not per-loop. One stored cadence that no longer computes — a
      // hand-edited document, a zone the parser rejects — used to throw out of
      // this loop and reject the whole tick, which turned a single bad document
      // into a 500 for every tenant on every request until somebody found it.
      // Disabling the offender is what makes it visible; silently skipping it
      // would leave it enabled and re-tried, and re-logged, every tick forever.
      const outcome = nextClaim(candidate.cadence, now);
      if (!outcome.ok) {
        logger.error(
          { scheduleId: candidate.id, cadence: candidate.cadence, err: outcome.message },
          "schedule-cadence-uncomputable",
        );
        await this.scheduleCollection.updateOne(
          { _id: candidate._id, enabled: true, nextRunAt: candidate.nextRunAt },
          { $set: { enabled: false, updatedAt: nowISO } },
        );
        continue;
      }

      const pre = await this.scheduleCollection.findOneAndUpdate(
        { _id: candidate._id, enabled: true, nextRunAt: candidate.nextRunAt },
        {
          $set: {
            nextRunAt: outcome.nextRunAt,
            lastRunAt: nowISO,
            updatedAt: nowISO,
            // A `once` schedule disables itself rather than being claimed again.
            ...(outcome.disable ? { enabled: false } : {}),
          },
        },
        { returnDocument: "before" },
      );

      if (pre) claimed.push(hydrateDocument(pre));
    }

    return claimed;
  }

  async createRun(
    run: Omit<ScheduleRun, "id" | "createdAt" | "updatedAt">,
  ): Promise<ScheduleRun> {
    const now = new Date().toISOString();
    const id = generateId();
    const doc: WithMongoId<ScheduleRunDocument> = dropUndefinedFields({
      ...run,
      id,
      _id: id,
      createdAt: now,
      updatedAt: now,
    });
    await this.runCollection.insertOne(doc);
    return hydrateDocument(doc);
  }

  /** Whether the schedule has an attempt in flight or waiting to retry. */
  async hasOpenRun(scheduleId: string): Promise<boolean> {
    const count = await this.runCollection.countDocuments(
      { scheduleId, status: { $in: ["pending", "running"] } },
      { limit: 1 },
    );
    return count > 0;
  }

  /**
   * Records an occurrence the overlap policy dropped. Counted rather than
   * inserted, because a schedule firing every minute with a long run would
   * otherwise grow history without bound.
   */
  async markSkipped(scheduleId: string, nowISO: string): Promise<void> {
    await this.scheduleCollection.updateOne(
      { _id: scheduleId },
      { $inc: { skippedRuns: 1 }, $set: { updatedAt: nowISO } },
    );
  }

  /**
   * Claims due runs, oldest first, and flips them to `running`.
   *
   * That flip is the at-least-once boundary: once it happens the run will
   * execute — here, or by whoever reclaims the lease. `returnDocument: "after"`
   * is required rather than incidental, because the executor needs the
   * *incremented* `attempt` to decide whether a retry is still permitted.
   */
  async claimDueRuns(nowISO: string, limit: number): Promise<ScheduleRun[]> {
    const leaseExpiresAt = new Date(
      Date.parse(nowISO) + SCHEDULE_LEASE_MS,
    ).toISOString();
    const claimed: ScheduleRun[] = [];

    while (claimed.length < limit) {
      const post = await this.runCollection.findOneAndUpdate(
        { status: "pending", nextAttemptAt: { $lte: nowISO } },
        {
          $set: {
            status: "running",
            startedAt: nowISO,
            leaseExpiresAt,
            updatedAt: nowISO,
          },
          $inc: { attempt: 1 },
        },
        { returnDocument: "after", sort: { nextAttemptAt: 1 } },
      );

      if (!post) break;
      claimed.push(hydrateDocument(post));
    }

    return claimed;
  }

  /**
   * Claims one named run, for a caller that already knows which run it wants.
   *
   * Same flip as `claimDueRuns` -- `pending` to `running`, `$inc: attempt` -- with
   * two differences, both deliberate:
   *
   * - No `nextAttemptAt` bound. This is the dispatch seam: "Run now" creates a run
   *   and immediately hands it here, and an external worker is told exactly which
   *   run to drive. Requiring the run to be due would make the caller wait for a
   *   tick that may be a minute away.
   * - `userId` is optional, because only one of the two callers has a session. The
   *   cron-authenticated route has none, and scoping it to a user would make the
   *   seam unroutable; the session-authenticated "Run now" route passes it, so a
   *   user cannot dispatch somebody else's run by guessing an id.
   *
   * `returnDocument: "after"` for the same reason as `claimDueRuns`: the executor
   * needs the incremented `attempt` to decide whether a retry is still permitted.
   */
  async claimRunById(
    runId: string,
    nowISO: string,
    userId?: string,
  ): Promise<ScheduleRun | null> {
    const post = await this.runCollection.findOneAndUpdate(
      { _id: runId, status: "pending", ...(userId === undefined ? {} : { userId }) },
      {
        $set: {
          status: "running",
          startedAt: nowISO,
          leaseExpiresAt: new Date(
            Date.parse(nowISO) + SCHEDULE_LEASE_MS,
          ).toISOString(),
          updatedAt: nowISO,
        },
        $inc: { attempt: 1 },
      },
      { returnDocument: "after" },
    );
    return post ? hydrateDocument(post) : null;
  }

  /**
   * Hands runs whose lease lapsed back for retry, or fails them once their
   * attempts are spent. Returns how many were reaped.
   *
   * This is what makes a killed serverless invocation survivable: without it a
   * run left `running` by a process that died would sit there forever.
   */
  async reapExpiredLeases(nowISO: string): Promise<number> {
    const stale = await this.runCollection
      .find({ status: "running", leaseExpiresAt: { $lte: nowISO } })
      .toArray();

    const now = new Date(nowISO);
    for (const doc of stale) {
      await this.settleRun(doc._id, reaperOutcome(hydrateDocument(doc), now));
    }

    return stale.length;
  }

  /**
   * Writes the outcome of one attempt.
   *
   * `finishedAt` and `durationMs` are recorded for every outcome including a
   * retry, because they describe the attempt that just ended rather than the
   * run as a whole; the next attempt overwrites both. The lease is cleared
   * unconditionally — whatever the outcome, this run is no longer the one
   * holding it.
   *
   * The schedule's own `lastRunStatus` is written here too, because this is the
   * only place a run reaches a state the caller can act on. It is a denormalised
   * copy of the newest run's status, so a schedule list need not read the run
   * collection to answer "what happened last time" — which is why it is written
   * from the run's own `scheduleId` rather than passed in, and why a schedule
   * whose runs are all deleted keeps its last-known status. `skippedRuns` is
   * deliberately not reflected here: an overlap skip writes no run at all, and
   * `skippedRuns` already surfaces it as its own counter.
   */
  async settleRun(runId: string, outcome: SettleOutcome): Promise<void> {
    const finishedAt = new Date().toISOString();
    const started = await this.runCollection.findOne(
      { _id: runId },
      { projection: { startedAt: 1, scheduleId: 1 } },
    );

    const fields: Record<string, unknown> = {
      status: outcome.status,
      finishedAt,
      updatedAt: finishedAt,
      leaseExpiresAt: null,
    };

    if (started?.startedAt) {
      fields.durationMs = Date.parse(finishedAt) - Date.parse(started.startedAt);
    }
    if (outcome.status === "pending") {
      fields.nextAttemptAt = outcome.nextAttemptAt;
      fields.error = outcome.error;
    } else if (outcome.status === "failed") {
      fields.error = outcome.error;
    } else if (outcome.resultRef) {
      fields.resultRef = outcome.resultRef;
    }

    await this.runCollection.updateOne(
      { _id: runId },
      { $set: dropUndefinedFields(fields) },
    );

    if (started?.scheduleId) {
      await this.scheduleCollection.updateOne(
        { _id: started.scheduleId },
        { $set: { lastRunStatus: outcome.status, updatedAt: finishedAt } },
      );
    }
  }

  /**
   * Extends a live lease. Scoped to `running` so a late renewal from the tick
   * that used to own the run cannot resurrect one that has already settled.
   */
  async renewLease(runId: string, leaseExpiresAt: string): Promise<void> {
    await this.runCollection.updateOne(
      { _id: runId, status: "running" },
      { $set: { leaseExpiresAt, updatedAt: new Date().toISOString() } },
    );
  }

  async getRuns(
    scheduleId: string,
    userId: string,
    limit: number,
    skip = 0,
  ): Promise<ScheduleRun[]> {
    const docs = await this.runCollection
      .find({ scheduleId, userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    return docs.map(hydrateDocument);
  }

  async countRuns(scheduleId: string, userId: string): Promise<number> {
    return this.runCollection.countDocuments({ scheduleId, userId });
  }

  async getRun(runId: string, userId: string): Promise<ScheduleRun | null> {
    const doc = await this.runCollection.findOne({ _id: runId, userId });
    return doc ? hydrateDocument(doc) : null;
  }
}

/** The retention instant for a run created now. A real `Date`, because the TTL index needs one. */
export function runExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SCHEDULE_RUN_RETENTION_DAYS * 86_400_000);
}
