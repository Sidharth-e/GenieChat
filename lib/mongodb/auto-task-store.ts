import "server-only";
import { Collection } from "mongodb";
import { getAutoTasksCollection } from "./client";
import { generateId } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { WithMongoId, AutoTaskDocument } from "./common";

// Re-exported rather than redeclared, so `AutoTaskStatus` keeps a single source
// of truth now that the Cosmos store it used to come from is gone.
export type { AutoTaskStatus } from "./common";

// The app-level shape the Cosmos module declared. `toAutoTask` returns exactly
// the document's fields minus `type`, so deriving it here keeps the two from
// drifting.
export type AutoTask = Omit<AutoTaskDocument, "type">;

export class AutoTaskStore {
  private autoTasksCollection: Collection<WithMongoId<AutoTaskDocument>>;

  constructor() {
    this.autoTasksCollection = getAutoTasksCollection();
  }

  async createTask(userId: string, task: string): Promise<AutoTask> {
    const now = new Date().toISOString();
    const id = generateId();
    const doc: WithMongoId<AutoTaskDocument> = {
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the app-level `AutoTask` shape intact.
      _id: id,
      userId,
      task,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      type: "auto_task",
    };

    await this.autoTasksCollection.insertOne(doc);
    return this.toAutoTask(doc);
  }

  async getTask(taskId: string, userId: string): Promise<AutoTask | null> {
    try {
      // Cosmos read through `item(taskId, userId).read()` and then rejected a
      // document whose `type` was not `auto_task`; the filter carries both
      // predicates.
      const doc = await this.autoTasksCollection.findOne({
        _id: taskId,
        userId,
        type: "auto_task",
      });
      if (!doc) return null;
      return this.toAutoTask(doc);
    } catch {
      return null;
    }
  }

  async getPendingTask(userId: string): Promise<AutoTask | null> {
    // `SELECT TOP 1 ... ORDER BY c.createdAt ASC` becomes `findOne` with an
    // ascending sort -- the oldest pending task first, unlike the descending
    // order most of the other stores use.
    const doc = await this.autoTasksCollection.findOne(
      { userId, type: "auto_task", status: "pending" },
      { sort: { createdAt: 1 } },
    );

    if (!doc) return null;
    return this.toAutoTask(doc);
  }

  // Deliberately NOT a compare-and-swap, matching the Cosmos store: it read the
  // task, tested `status === "pending"` in JavaScript, and replaced with no
  // access condition, so two workers that both read `pending` both claim it.
  // That hazard predates the migration (this store never had an `_etag`) and is
  // recorded in the ledger; rewriting it as an atomic
  // `findOneAndUpdate({ _id, userId, status: "pending" })` would change
  // behaviour this migration is not chartered to change.
  async claimTask(taskId: string, userId: string): Promise<boolean> {
    try {
      const existingTask = await this.autoTasksCollection.findOne({
        _id: taskId,
        userId,
        type: "auto_task",
      });
      if (!existingTask || existingTask.status !== "pending") return false;

      const updated: WithMongoId<AutoTaskDocument> = {
        ...existingTask,
        status: "running",
        updatedAt: new Date().toISOString(),
      };

      // Cosmos replaced through `item(taskId, userId).replace(resource)`, which
      // throws when the document has vanished since the read; `matchedCount`
      // restores that, and the `catch` below turns it into the same `false` the
      // not-pending branch above returns.
      const { _id, ...rest } = updated;
      const result = await this.autoTasksCollection.replaceOne(
        { _id: existingTask._id },
        rest,
      );
      if (result.matchedCount === 0) {
        throw new Error(`Auto task not found: ${_id}`);
      }
      return true;
    } catch (error) {
      logger.error("Error claiming auto task:", error);
      return false;
    }
  }

  async completeTask(taskId: string, userId: string, result: string): Promise<void> {
    try {
      const existingTask = await this.autoTasksCollection.findOne({
        _id: taskId,
        userId,
        type: "auto_task",
      });
      if (!existingTask) return;

      const updated: WithMongoId<AutoTaskDocument> = {
        ...existingTask,
        status: "completed",
        result,
        updatedAt: new Date().toISOString(),
      };

      // Same `matchedCount` guard as `claimTask`: Cosmos's
      // `item(taskId, userId).replace(resource)` threw on a document that
      // vanished between the read and the write, and the `catch` below swallows
      // it as this method already did.
      const { _id, ...rest } = updated;
      const replaceResult = await this.autoTasksCollection.replaceOne(
        { _id: existingTask._id },
        rest,
      );
      if (replaceResult.matchedCount === 0) {
        throw new Error(`Auto task not found: ${_id}`);
      }
    } catch (error) {
      logger.error("Error completing auto task:", error);
    }
  }

  async failTask(taskId: string, userId: string, error: string): Promise<void> {
    try {
      const existingTask = await this.autoTasksCollection.findOne({
        _id: taskId,
        userId,
        type: "auto_task",
      });
      if (!existingTask) return;

      const updated: WithMongoId<AutoTaskDocument> = {
        ...existingTask,
        status: "failed",
        error,
        updatedAt: new Date().toISOString(),
      };

      // Same `matchedCount` guard as `completeTask`.
      const { _id, ...rest } = updated;
      const replaceResult = await this.autoTasksCollection.replaceOne(
        { _id: existingTask._id },
        rest,
      );
      if (replaceResult.matchedCount === 0) {
        throw new Error(`Auto task not found: ${_id}`);
      }
    } catch (err) {
      logger.error("Error failing auto task:", err);
    }
  }

  // Built from named fields, never a spread, so the driver's `_id` cannot leak
  // into the returned task -- no `hydrateDocument` step is needed here.
  private toAutoTask(doc: WithMongoId<AutoTaskDocument>): AutoTask {
    return {
      id: doc.id,
      userId: doc.userId,
      task: doc.task,
      status: doc.status,
      result: doc.result,
      error: doc.error,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
