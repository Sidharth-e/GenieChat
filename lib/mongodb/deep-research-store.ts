import { Collection } from "mongodb";
import { getDeepResearchCollection } from "./client";
import { DeepResearchReport } from "../types";
import { DeepResearchReportDocument, WithMongoId, hydrateDocument } from "./common";
import { generateId } from "../utils";
import type Redis from "ioredis";
import { getRedisClient, type RedisClientOptions } from "@/lib/redis-client";
import { logger } from "@/lib/logger";

const CHECKPOINT_PREFIX = "deep_research:checkpoint:";
const DEFAULT_CHECKPOINT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export interface DeepResearchCheckpoint {
  runId: string;
  userId: string;
  query: string;
  plan: string[];
  outline?: string;
  status: "running" | "completed" | "failed";
  state: Record<string, unknown>;
  updatedAt: string;
}

interface DeepResearchStoreOptions {
  redisClient?: Redis | null;
  withDatabase?: boolean;
}

/**
 * Checkpoint writes are worth waiting for, so this client retries rather than
 * failing fast — the opposite of the rate limiter's setting. Its disable window
 * is longer too, because falling back to MongoDB is cheap and a flapping
 * reconnect is not.
 */
const REDIS_OPTIONS: RedisClientOptions = {
  maxRetriesPerRequest: null,
  disableWindowMs: 60_000,
};

/**
 * The checkpoint cache is strictly an optimisation: an unconfigured or failing
 * Redis both resolve to `null`, and every method below then falls through to
 * MongoDB.
 */
function getCheckpointRedisClient(): Redis | null {
  const resolution = getRedisClient("deep-research", REDIS_OPTIONS);
  return resolution.status === "ready" ? resolution.client : null;
}

export class DeepResearchStore {
  private deepResearchCollection: Collection<
    WithMongoId<DeepResearchReportDocument>
  > | null;
  private redis: Redis | null;

  constructor(options: DeepResearchStoreOptions = {}) {
    this.deepResearchCollection =
      options.withDatabase === false ? null : getDeepResearchCollection();
    this.redis = options.redisClient ?? getCheckpointRedisClient();
  }

  private requireCollection(): Collection<
    WithMongoId<DeepResearchReportDocument>
  > {
    if (!this.deepResearchCollection) {
      throw new Error(
        "DeepResearchStore report operations require database configuration.",
      );
    }

    return this.deepResearchCollection;
  }

  async saveReport(
    report: Omit<DeepResearchReport, "id" | "createdAt">,
  ): Promise<DeepResearchReport> {
    const now = new Date().toISOString();
    const id = generateId();
    const doc: WithMongoId<DeepResearchReportDocument> = {
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and delete in this layer addresses the document by,
      // while `id` keeps the `DeepResearchReport` shape intact. The Cosmos
      // store's commented-out partition-key line is gone with the field itself.
      _id: id,
      type: "deep_research_report",
      userId: report.userId,
      userName: report.userName,
      userEmail: report.userEmail,
      title: report.title,
      query: report.query,
      reportRef: report.reportRef,
      createdAt: now,
    };

    await this.requireCollection().insertOne(doc);
    return hydrateDocument(doc);
  }

  async getReport(
    reportId: string,
    userId: string,
  ): Promise<DeepResearchReport | null> {
    try {
      // Cosmos read through `item(reportId, userId).read()`, whose second
      // argument was the partition key; the ownership check it implied is the
      // `userId` predicate here.
      const doc = await this.requireCollection().findOne({
        _id: reportId,
        userId,
      });
      if (!doc) return null;
      return hydrateDocument(doc);
    } catch {
      return null;
    }
  }

  async getReports(userId: string): Promise<DeepResearchReport[]> {
    // Semantic fix, not a substitution: the Cosmos query filtered on the
    // stored partition-key field, because Cosmos wrote the partition key as a
    // real document field. That field does not exist under Mongo, so a
    // mechanical translation would have matched nothing, silently; `userId` is
    // the field the documents actually carry.
    const docs = await this.requireCollection()
      .find({ userId, type: "deep_research_report" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async deleteReport(reportId: string, userId: string): Promise<boolean> {
    try {
      // `userId` stays: it is the ownership check Cosmos's
      // `item(reportId, userId).delete()` performed through its partition key,
      // and it is what makes a cross-tenant delete a no-op rather than a write.
      //
      // Cosmos's `item().delete()` threw a 404 when the address matched nothing,
      // which the bare `catch` below turned into `false`; Mongo's `deleteOne`
      // matches nothing without throwing, so without the `deletedCount` test the
      // method would report success for a report it never deleted. Checking the
      // count restores Cosmos's return value and adds no throw, so the rule that
      // a delete needs no `matchedCount` guard still holds.
      const result = await this.requireCollection().deleteOne({
        _id: reportId,
        userId,
      });
      return result.deletedCount > 0;
    } catch {
      return false;
    }
  }

  private checkpointKey(runId: string, userId: string): string {
    return `${CHECKPOINT_PREFIX}${userId}:${runId}`;
  }

  async saveCheckpoint(
    checkpoint: Omit<DeepResearchCheckpoint, "updatedAt">,
    ttlSeconds: number = DEFAULT_CHECKPOINT_TTL_SECONDS,
  ): Promise<DeepResearchCheckpoint | null> {
    if (!this.redis) return null;

    const payload: DeepResearchCheckpoint = {
      ...checkpoint,
      updatedAt: new Date().toISOString(),
    };

    const key = this.checkpointKey(checkpoint.runId, checkpoint.userId);

    try {
      await this.redis.set(key, JSON.stringify(payload), "EX", ttlSeconds);
      return payload;
    } catch (error) {
      logger.warn("[DeepResearchStore] Failed to save Redis checkpoint", error);
      return null;
    }
  }

  async getCheckpoint(
    runId: string,
    userId: string,
  ): Promise<DeepResearchCheckpoint | null> {
    if (!this.redis) return null;

    const key = this.checkpointKey(runId, userId);

    try {
      const data = await this.redis.get(key);
      if (!data) return null;

      return JSON.parse(data) as DeepResearchCheckpoint;
    } catch (error) {
      logger.warn("[DeepResearchStore] Failed to read Redis checkpoint", error);
      return null;
    }
  }

  async deleteCheckpoint(runId: string, userId: string): Promise<boolean> {
    if (!this.redis) return false;

    const key = this.checkpointKey(runId, userId);

    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.warn("[DeepResearchStore] Failed to delete Redis checkpoint", error);
      return false;
    }
  }
}

export function getDeepResearchStore(): DeepResearchStore {
  return new DeepResearchStore();
}

export function getDeepResearchCheckpointStore(): DeepResearchStore {
  return new DeepResearchStore({ withDatabase: false });
}
