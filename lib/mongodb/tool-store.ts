import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getToolCollection } from "./client";
import { CustomTool } from "../types";
import { generateId } from "../utils";
import { WithMongoId, CustomToolDocument, hydrateDocument } from "./common";

export class ToolStore {
  private toolCollection: Collection<WithMongoId<CustomToolDocument>>;

  constructor() {
    this.toolCollection = getToolCollection();
  }

  // Create a new custom tool (user-scoped)
  async createTool(
    tool: Omit<CustomTool, "id" | "createdAt" | "updatedAt">,
  ): Promise<CustomTool> {
    const now = new Date().toISOString();
    const id = generateId();
    const newTool: WithMongoId<CustomToolDocument> = {
      ...tool,
      id,
      _id: id,
      type: "custom_tool",
      createdAt: now,
      updatedAt: now,
    };

    await this.toolCollection.insertOne(newTool);
    return hydrateDocument(newTool);
  }

  // Get all custom tools for a specific user
  async getTools(userId: string): Promise<CustomTool[]> {
    const docs = await this.toolCollection
      .find({ userId, type: "custom_tool" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  // Get a single tool by ID
  async getTool(toolId: string): Promise<CustomTool | null> {
    try {
      const doc = await this.toolCollection.findOne({
        _id: toolId,
        type: "custom_tool",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting tool:", error);
      return null;
    }
  }

  // Get the raw document (including `_id`) for update/delete operations
  private async getToolDocument(
    toolId: string,
  ): Promise<WithMongoId<CustomToolDocument> | null> {
    try {
      return await this.toolCollection.findOne({
        _id: toolId,
        type: "custom_tool",
      });
    } catch (error) {
      logger.error("Error getting tool document:", error);
      return null;
    }
  }

  // Update a tool
  async updateTool(
    toolId: string,
    updates: Partial<CustomTool>,
  ): Promise<CustomTool | null> {
    try {
      // Get the raw document
      const existingDoc = await this.getToolDocument(toolId);
      if (!existingDoc) return null;

      const updated: WithMongoId<CustomToolDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // tool or move it in a listing.
        userId: existingDoc.userId,
        type: "custom_tool",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.toolCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Tool not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating tool:", error);
      return null;
    }
  }

  // Delete a tool
  async deleteTool(toolId: string): Promise<boolean> {
    try {
      // Verify tool exists first
      const existingDoc = await this.getToolDocument(toolId);
      if (!existingDoc) return false;

      await this.toolCollection.deleteOne({ _id: toolId });
      return true;
    } catch (error) {
      logger.error("Error deleting tool:", error);
      return false;
    }
  }
}
