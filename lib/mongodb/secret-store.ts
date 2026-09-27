import { logger } from "@/lib/logger";
import { encrypt, decrypt } from "@/lib/crypto";
import { Collection } from "mongodb";
import { getToolSecretsCollection } from "./client";
import { ToolSecret } from "../types";
import { generateId } from "../utils";
import { WithMongoId, ToolSecretDocument, hydrateDocument } from "./common";

export class SecretStore {
  private secretCollection: Collection<WithMongoId<ToolSecretDocument>>;

  constructor() {
    this.secretCollection = getToolSecretsCollection();
  }

  // Create a new secret
  async createSecret(
    secret: Omit<ToolSecret, "id" | "createdAt" | "updatedAt">,
  ): Promise<ToolSecret> {
    const now = new Date().toISOString();
    const id = generateId();
    const newSecret: WithMongoId<ToolSecretDocument> = {
      ...secret,
      value: encrypt(secret.value),
      id,
      // Mongo's mandatory key, holding the same generated value as `id` --
      // `_id` is what every read and update in this layer addresses the
      // document by, while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      type: "tool_secret",
      createdAt: now,
      updatedAt: now,
    };

    await this.secretCollection.insertOne(newSecret);
    const result = hydrateDocument(newSecret);
    result.value = secret.value; // return decrypted value to caller directly since we know it
    return result;
  }

  // Get all secrets for a user
  async getSecrets(userId: string): Promise<ToolSecret[]> {
    const docs = await this.secretCollection
      .find({ userId, type: "tool_secret" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => {
      const secret = hydrateDocument(doc);
      secret.value = decrypt(secret.value);
      return secret;
    });
  }

  // Get a specific secret
  async getSecret(secretId: string, userId: string): Promise<ToolSecret | null> {
    try {
      const doc = await this.secretCollection.findOne({
        _id: secretId,
        userId,
        type: "tool_secret",
      });

      if (!doc) return null;

      const secret = hydrateDocument(doc);
      secret.value = decrypt(secret.value);
      return secret;
    } catch (error) {
      logger.error("Error getting secret:", error);
      return null;
    }
  }

  // Delete a secret
  async deleteSecret(secretId: string, userId: string): Promise<boolean> {
    try {
      const doc = await this.secretCollection.findOne({
        _id: secretId,
        userId,
        type: "tool_secret",
      });

      if (!doc) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId`/`type` filter -- both were just applied to the read above
      // and Cosmos's `item(id, userId).delete()` addressed the same document.
      await this.secretCollection.deleteOne({ _id: secretId });
      return true;
    } catch (error) {
      logger.error("Error deleting secret:", error);
      return false;
    }
  }
}
