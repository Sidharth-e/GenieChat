import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getMcpServerCollection } from "./client";
import { MCPServerConfig } from "../types";
import { generateId } from "../utils";
import { WithMongoId, MCPServerDocument, hydrateDocument } from "./common";

export class MCPStore {
  private mcpServerCollection: Collection<WithMongoId<MCPServerDocument>>;

  constructor() {
    this.mcpServerCollection = getMcpServerCollection();
  }

  // MCP Server operations (user-scoped)
  async createMCPServer(
    server: Omit<MCPServerConfig, "id" | "createdAt" | "updatedAt">,
  ): Promise<MCPServerConfig> {
    const now = new Date().toISOString();
    const id = generateId();
    const newServer: WithMongoId<MCPServerDocument> = {
      ...server,
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      type: "mcp_server",
      createdAt: now,
      updatedAt: now,
    };

    await this.mcpServerCollection.insertOne(newServer);
    return hydrateDocument(newServer);
  }

  // Get all MCP servers for a specific user
  async getMCPServers(userId: string): Promise<MCPServerConfig[]> {
    // Sorted by `updatedAt`, not `createdAt` -- the Cosmos query ordered by
    // `c.updatedAt DESC`, so the list is most-recently-changed first.
    const docs = await this.mcpServerCollection
      .find({ userId, type: "mcp_server" })
      .sort({ updatedAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async getMCPServer(serverId: string): Promise<MCPServerConfig | null> {
    try {
      const doc = await this.mcpServerCollection.findOne({
        _id: serverId,
        type: "mcp_server",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting MCP server:", error);
      return null;
    }
  }

  async updateMCPServer(
    serverId: string,
    updates: Partial<MCPServerConfig>,
  ): Promise<MCPServerConfig | null> {
    try {
      const existingDoc = await this.mcpServerCollection.findOne({
        _id: serverId,
        type: "mcp_server",
      });

      if (!existingDoc) return null;

      const updated: WithMongoId<MCPServerDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // server or move it in a listing.
        userId: existingDoc.userId,
        type: "mcp_server",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // Cosmos replaced through `item(serverId, userId).replace(updated)`, which
      // throws when the document has vanished since the read; `matchedCount`
      // restores that, and the `catch` below turns it into the same `null` the
      // missing-document branch above returns.
      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.mcpServerCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`MCP server not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating MCP server:", error);
      return null;
    }
  }

  async deleteMCPServer(serverId: string): Promise<boolean> {
    try {
      const doc = await this.mcpServerCollection.findOne({
        _id: serverId,
        type: "mcp_server",
      });

      if (!doc) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId`/`type` filter -- both were just applied to the read above
      // and Cosmos's `item(serverId, userId).delete()` addressed the same
      // document.
      await this.mcpServerCollection.deleteOne({ _id: serverId });

      return true;
    } catch (error) {
      logger.error("Error deleting MCP server:", error);
      return false;
    }
  }
}
