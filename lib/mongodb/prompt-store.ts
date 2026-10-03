import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getPromptCollection } from "./client";
import { Prompt } from "../types";
import { generateId } from "../utils";
import { WithMongoId, PromptDocument, hydrateDocument } from "./common";

export class PromptStore {
  private promptCollection: Collection<WithMongoId<PromptDocument>>;

  constructor() {
    this.promptCollection = getPromptCollection();
  }

  private mapPromptDocument(
    doc: WithMongoId<PromptDocument>,
    viewerUserId?: string,
  ): Prompt {
    const hydrated = hydrateDocument(doc);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { favoriteUserIds, isFavorite: _legacyFavoriteFlag, ...promptData } =
      hydrated;

    const isFavorite =
      !!viewerUserId && Array.isArray(favoriteUserIds)
        ? favoriteUserIds.includes(viewerUserId)
        : false;

    return {
      ...promptData,
      isFavorite,
    };
  }

  private async getPromptDocument(
    promptId: string,
  ): Promise<WithMongoId<PromptDocument> | null> {
    const doc = await this.promptCollection.findOne({
      _id: promptId,
      type: "prompt",
    });

    return doc ?? null;
  }

  // Prompt operations
  async createPrompt(
    prompt: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount">,
  ): Promise<Prompt> {
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isFavorite: _ignoredFavorite, ...promptData } = prompt;
    const id = generateId();
    const newPrompt: WithMongoId<PromptDocument> = {
      ...promptData,
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      type: "prompt",
      tags: prompt.tags ?? [],
      variables: prompt.variables ?? [],
      favoriteUserIds: [],
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
    };

    await this.promptCollection.insertOne(newPrompt);
    return this.mapPromptDocument(newPrompt, prompt.userId);
  }

  async getPrompts(userId: string): Promise<Prompt[]> {
    // The `userId` equality is the authorization boundary, not a convenience
    // filter: a prompt carries no visibility flag of its own, so a listing is
    // exactly the prompts its reader owns.
    const docs = await this.promptCollection
      .find({
        type: "prompt",
        userId,
      })
      .sort({ updatedAt: -1 })
      .toArray();

    return docs.map((doc) => this.mapPromptDocument(doc, userId));
  }

  async getPrompt(
    promptId: string,
    viewerUserId?: string,
  ): Promise<Prompt | null> {
    const prompt = await this.getPromptDocument(promptId);
    if (!prompt) return null;
    return this.mapPromptDocument(prompt, viewerUserId);
  }

  async updatePrompt(
    promptId: string,
    updates: Partial<Prompt>,
    viewerUserId?: string,
  ): Promise<Prompt | null> {
    try {
      const existingDoc = await this.getPromptDocument(promptId);
      if (!existingDoc) return null;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { isFavorite: _ignoredFavorite, ...safeUpdates } = updates;
      const updated: WithMongoId<PromptDocument> = {
        ...existingDoc,
        ...safeUpdates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // prompt or move it in another user's listing.
        userId: existingDoc.userId,
        type: "prompt",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // Cosmos replaced through `item(promptId, userId).replace(updated)`, which
      // throws when the document has vanished since the read; `matchedCount`
      // restores that, and the `catch` below turns it into the same `null` the
      // missing-document branch above returns.
      // The filter comes from the read, not the merge: this route spreads the
      // request body, so an `_id` in it would otherwise retarget the write.
      const { _id, ...rest } = updated;
      const result = await this.promptCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Prompt not found: ${_id}`);
      }

      return this.mapPromptDocument(updated, viewerUserId);
    } catch (error) {
      logger.error("Error updating prompt:", error);
      return null;
    }
  }

  async deletePrompt(promptId: string): Promise<boolean> {
    try {
      const prompt = await this.getPromptDocument(promptId);
      if (!prompt) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId`/`type` filter -- both were just applied to the read above
      // and Cosmos's `item(promptId, prompt.userId).delete()` addressed the same
      // document.
      await this.promptCollection.deleteOne({ _id: promptId });

      return true;
    } catch (error) {
      logger.error("Error deleting prompt:", error);
      return false;
    }
  }

  async setPromptFavorite(
    promptId: string,
    userId: string,
    favorite: boolean,
  ): Promise<Prompt | null> {
    try {
      const existingPrompt = await this.getPromptDocument(promptId);
      if (!existingPrompt) return null;

      const favoriteUserIdSet = new Set(existingPrompt.favoriteUserIds ?? []);

      if (favorite) {
        favoriteUserIdSet.add(userId);
      } else {
        favoriteUserIdSet.delete(userId);
      }

      const updatedPrompt: WithMongoId<PromptDocument> = {
        ...existingPrompt,
        favoriteUserIds: Array.from(favoriteUserIdSet),
      };

      // Same `matchedCount` guard as `updatePrompt`. The filter names the read
      // document; nothing caller-supplied is spread here (`favoriteUserIds` is
      // computed above), so there is no identity field to re-assert.
      const { _id, ...rest } = updatedPrompt;
      const result = await this.promptCollection.replaceOne({ _id: existingPrompt._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Prompt not found: ${_id}`);
      }

      return this.mapPromptDocument(updatedPrompt, userId);
    } catch (error) {
      logger.error("Error setting prompt favorite:", error);
      return null;
    }
  }
}
