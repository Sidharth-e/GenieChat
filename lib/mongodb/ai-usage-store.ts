import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getAiUsageCollection } from "./client";
import { WithMongoId, AiUsageDocument, hydrateDocument } from "./common";
import { AiUsage } from "../types";
import { generateId } from "../utils";

export type AiUsageRecord = AiUsage;
export type AiUsageInput = Omit<AiUsage, "id" | "createdAt">;

export class AiUsageStore {
  private aiUsageCollection: Collection<WithMongoId<AiUsageDocument>>;

  constructor() {
    this.aiUsageCollection = getAiUsageCollection();
  }

  async logUsage(record: AiUsageInput): Promise<void> {
    const id = generateId();
    const doc: WithMongoId<AiUsageDocument> = {
      ...record,
      id,
      _id: id,
      createdAt: new Date().toISOString(),
      type: "ai_usage",
    };
    try {
      await this.aiUsageCollection.insertOne(doc);
    } catch (err) {
      logger.error({ err }, "[AiUsageStore] Failed to log usage record");
    }
  }

  async getUsageByUser(userId: string, limit = 100): Promise<AiUsageRecord[]> {
    try {
      const docs = await this.aiUsageCollection
        .find({ userId, type: "ai_usage" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return docs.map((doc) => hydrateDocument(doc));
    } catch (err) {
      logger.error({ err }, "[AiUsageStore] Failed to query usage records");
      return [];
    }
  }
}
