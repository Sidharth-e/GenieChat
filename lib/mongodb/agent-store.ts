import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getAgentCollection } from "./client";
import { Agent } from "../types";
import { generateId } from "../utils";
import { WithMongoId, AgentDocument, hydrateDocument } from "./common";

export class AgentStore {
  private agentCollection: Collection<WithMongoId<AgentDocument>>;

  constructor() {
    this.agentCollection = getAgentCollection();
  }

  // Create a new agent (user-scoped)
  async createAgent(
    agent: Omit<Agent, "id" | "createdAt" | "updatedAt">,
  ): Promise<Agent> {
    const now = new Date().toISOString();
    const id = generateId();
    const newAgent: WithMongoId<AgentDocument> = {
      ...agent,
      id,
      _id: id,
      type: "agent",
      createdAt: now,
      updatedAt: now,
    };

    await this.agentCollection.insertOne(newAgent);
    return hydrateDocument(newAgent);
  }

  // Get all agents for a specific user
  async getAgents(userId: string): Promise<Agent[]> {
    const docs = await this.agentCollection
      .find({ userId, type: "agent" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  // `userId` is kept only for signature compatibility with the Cosmos store:
  // `_id` is a globally unique uuidv7, so the read no longer needs it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAgent(agentId: string, userId?: string): Promise<Agent | null> {
    try {
      const doc = await this.agentCollection.findOne({
        _id: agentId,
        type: "agent",
      });
      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting agent:", error);
      return null;
    }
  }

  // Get the raw document (including `_id`) for update/delete operations
  private async getAgentDocument(
    agentId: string,
  ): Promise<WithMongoId<AgentDocument> | null> {
    try {
      return await this.agentCollection.findOne({
        _id: agentId,
        type: "agent",
      });
    } catch (error) {
      logger.error("Error getting agent document:", error);
      return null;
    }
  }

  async updateAgent(
    agentId: string,
    updates: Partial<Agent>,
    // `userId` is kept only for signature compatibility with the Cosmos store:
    // `_id` is a globally unique uuidv7, so the update no longer needs it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userId?: string,
  ): Promise<Agent | null> {
    try {
      const existingDoc = await this.getAgentDocument(agentId);
      if (!existingDoc) return null;

      const updated: WithMongoId<AgentDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // document or move it in a listing.
        userId: existingDoc.userId,
        type: "agent",
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.agentCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Agent not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating agent:", error);
      return null;
    }
  }

  // `userId` is kept only for signature compatibility with the Cosmos store:
  // `_id` is a globally unique uuidv7, so the delete no longer needs it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteAgent(agentId: string, userId?: string): Promise<boolean> {
    try {
      const existingDoc = await this.getAgentDocument(agentId);
      if (!existingDoc) return false;

      await this.agentCollection.deleteOne({ _id: agentId });
      return true;
    } catch (error) {
      logger.error("Error deleting agent:", error);
      return false;
    }
  }

  // Set an agent as active (deactivate all others for this user)
  async setActiveAgent(agentId: string, userId: string): Promise<boolean> {
    try {
      const agents = await this.getAgents(userId);

      for (const agent of agents) {
        const shouldBeActive = agent.id === agentId;
        if (agent.active !== shouldBeActive) {
          await this.updateAgent(agent.id, { active: shouldBeActive });
        }
      }

      return true;
    } catch (error) {
      logger.error("Error setting active agent:", error);
      return false;
    }
  }
}
