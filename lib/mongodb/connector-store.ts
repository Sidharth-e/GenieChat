import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getConnectorCollection } from "./client";
import { ConnectorConfig } from "../types";
import { generateId } from "../utils";
import { WithMongoId, ConnectorDocument, hydrateDocument } from "./common";

export class ConnectorStore {
  private connectorCollection: Collection<WithMongoId<ConnectorDocument>>;

  constructor() {
    this.connectorCollection = getConnectorCollection();
  }

  // Connector operations (user-scoped)
  async createConnector(
    server: Omit<ConnectorConfig, "id" | "createdAt" | "updatedAt">,
  ): Promise<ConnectorConfig> {
    const now = new Date().toISOString();
    const id = generateId();
    const newServer: WithMongoId<ConnectorDocument> = {
      ...server,
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      type: "connector",
      createdAt: now,
      updatedAt: now,
    };

    await this.connectorCollection.insertOne(newServer);
    return hydrateDocument(newServer);
  }

  // Get all connectors for a specific user
  async getConnectors(userId: string): Promise<ConnectorConfig[]> {
    // Sorted by `updatedAt`, not `createdAt` -- the list is
    // most-recently-changed first.
    const docs = await this.connectorCollection
      .find({ userId, type: "connector" })
      .sort({ updatedAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async getConnector(serverId: string): Promise<ConnectorConfig | null> {
    try {
      const doc = await this.connectorCollection.findOne({
        _id: serverId,
        type: "connector",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting connector:", error);
      return null;
    }
  }

  async updateConnector(
    serverId: string,
    updates: Partial<ConnectorConfig>,
  ): Promise<ConnectorConfig | null> {
    try {
      const existingDoc = await this.connectorCollection.findOne({
        _id: serverId,
        type: "connector",
      });

      if (!existingDoc) return null;

      const updated: WithMongoId<ConnectorDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // server or move it in a listing.
        userId: existingDoc.userId,
        type: "connector",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // `replaceOne` reports a vanished document through `matchedCount` rather
      // than throwing; the `catch` below turns that into the same `null` the
      // missing-document branch above returns.
      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.connectorCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Connector not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating connector:", error);
      return null;
    }
  }

  async deleteConnector(serverId: string): Promise<boolean> {
    try {
      const doc = await this.connectorCollection.findOne({
        _id: serverId,
        type: "connector",
      });

      if (!doc) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId`/`type` filter -- both were just applied to the read above,
      // and `_id` alone addresses the same row.
      await this.connectorCollection.deleteOne({ _id: serverId });

      return true;
    } catch (error) {
      logger.error("Error deleting connector:", error);
      return false;
    }
  }
}
