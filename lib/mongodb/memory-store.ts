import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getMemoryCollection } from "./client";
import { Memory } from "../types";
import { generateId } from "../utils";
import { WithMongoId, MemoryDocument, hydrateDocument } from "./common";

export class MemoryStore {
  private memoryCollection: Collection<WithMongoId<MemoryDocument>>;

  constructor() {
    this.memoryCollection = getMemoryCollection();
  }

  async createMemory(
    memory: Omit<Memory, "id" | "createdAt" | "updatedAt" | "userName" | "userEmail"> & {
      userName?: string;
      userEmail?: string;
    },
  ): Promise<Memory> {
    const now = new Date().toISOString();
    const id = generateId();
    const newMemory: WithMongoId<MemoryDocument> = {
      ...memory,
      userName: memory.userName ?? "",
      userEmail: memory.userEmail ?? "",
      id,
      _id: id,
      type: "memory",
      createdAt: now,
      updatedAt: now,
    };

    await this.memoryCollection.insertOne(newMemory);
    return hydrateDocument(newMemory);
  }

  async getMemories(userId: string): Promise<Memory[]> {
    const docs = await this.memoryCollection
      .find({ userId, type: "memory" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    try {
      const doc = await this.memoryCollection.findOne({
        _id: memoryId,
        type: "memory",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting memory:", error);
      return null;
    }
  }

  // Get the raw document (including `_id`) for update/delete operations
  private async getMemoryDocument(
    memoryId: string,
  ): Promise<WithMongoId<MemoryDocument> | null> {
    try {
      return await this.memoryCollection.findOne({
        _id: memoryId,
        type: "memory",
      });
    } catch (error) {
      logger.error("Error getting memory document:", error);
      return null;
    }
  }

  async updateMemory(
    memoryId: string,
    updates: Partial<Memory>,
  ): Promise<Memory | null> {
    try {
      const existingDoc = await this.getMemoryDocument(memoryId);
      if (!existingDoc) return null;

      const updated: WithMongoId<MemoryDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // memory or move it in a listing.
        userId: existingDoc.userId,
        type: "memory",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.memoryCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Memory not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating memory:", error);
      return null;
    }
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    try {
      const existingDoc = await this.getMemoryDocument(memoryId);
      if (!existingDoc) return false;

      await this.memoryCollection.deleteOne({ _id: memoryId });
      return true;
    } catch (error) {
      logger.error("Error deleting memory:", error);
      return false;
    }
  }
}
