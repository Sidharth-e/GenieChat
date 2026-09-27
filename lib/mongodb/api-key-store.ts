import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getApiKeysCollection } from "./client";
import { ApiKey } from "../types";
import { generateId } from "../utils";
import { WithMongoId, ApiKeyDocument, hydrateDocument } from "./common";
import crypto from "crypto";

export class ApiKeyStore {
  private keyCollection: Collection<WithMongoId<ApiKeyDocument>>;

  constructor() {
    this.keyCollection = getApiKeysCollection();
  }

  /**
   * Hash a raw API key using SHA-256.
   */
  static hashKey(rawKey: string): string {
    return crypto.createHash("sha256").update(rawKey).digest("hex");
  }

  /**
   * Generate a new raw API key string like "sk-ag-<64 hex chars>".
   */
  static generateRawKey(): string {
    const hex = crypto.randomBytes(32).toString("hex");
    return `sk-ag-${hex}`;
  }

  /**
   * Create a new API key. Returns { apiKey, rawKey } -- rawKey is only available at creation time.
   */
  async createKey(params: {
    userId: string;
    userName: string;
    userEmail: string;
    name: string;
    scopes: string[];
    expiresAt?: string;
  }): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const rawKey = ApiKeyStore.generateRawKey();
    const keyHash = ApiKeyStore.hashKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12) + "...";
    const now = new Date().toISOString();

    const id = generateId();
    const doc: WithMongoId<ApiKeyDocument> = {
      id,
      // Mongo's mandatory key, holding the same generated value as `id`:
      // `_id` is what `findByHash`/`revokeKey`/`touchKey` address the document
      // by, while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      userId: params.userId,
      userName: params.userName,
      userEmail: params.userEmail,
      name: params.name,
      keyHash,
      keyPrefix,
      scopes: params.scopes,
      expiresAt: params.expiresAt,
      revoked: false,
      createdAt: now,
      updatedAt: now,
      type: "api_key",
    };

    await this.keyCollection.insertOne(doc);
    const apiKey = hydrateDocument(doc);

    return { apiKey, rawKey };
  }

  /**
   * Find a key by its SHA-256 hash. Returns null if not found, revoked, or expired.
   * The lookup is by hash alone, without knowing the userId.
   */
  async findByHash(hash: string): Promise<ApiKey | null> {
    try {
      const doc = await this.keyCollection.findOne({
        keyHash: hash,
        type: "api_key",
        revoked: false,
      });

      if (!doc) return null;

      // Check expiry
      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return null;
      }

      return hydrateDocument(doc);
    } catch (error) {
      logger.error("Error finding API key by hash:", error);
      return null;
    }
  }

  /**
   * List all keys for a user. Never returns keyHash to frontend.
   */
  async listKeys(userId: string): Promise<ApiKey[]> {
    const docs = await this.keyCollection
      .find({ userId, type: "api_key" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => {
      const key: ApiKey = hydrateDocument(doc);
      // Strip the hash so it is never sent to the frontend
      delete (key as Partial<Pick<ApiKey, "keyHash">>).keyHash;
      return key;
    });
  }

  /**
   * Revoke a key by setting revoked=true.
   */
  async revokeKey(keyId: string, userId: string): Promise<boolean> {
    try {
      const doc = await this.keyCollection.findOne({
        _id: keyId,
        userId,
        type: "api_key",
      });

      if (!doc) return false;

      doc.revoked = true;
      doc.updatedAt = new Date().toISOString();

      // Cosmos replaced through `item(keyId, userId).replace(doc)`, which
      // throws when the document has vanished since the read; `matchedCount`
      // restores that, and the `catch` below turns it into the same `false`
      // the missing-document branch above returns.
      const { _id, ...rest } = doc;
      const result = await this.keyCollection.replaceOne({ _id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`API key not found: ${_id}`);
      }
      return true;
    } catch (error) {
      logger.error("Error revoking API key:", error);
      return false;
    }
  }

  /**
   * Update lastUsedAt timestamp (fire-and-forget, non-critical).
   */
  async touchKey(keyId: string, userId: string): Promise<void> {
    try {
      const doc = await this.keyCollection.findOne({
        _id: keyId,
        userId,
        type: "api_key",
      });

      if (!doc) return;

      doc.lastUsedAt = new Date().toISOString();

      // Same `matchedCount` guard as `revokeKey`: Cosmos's
      // `item(keyId, userId).replace(doc)` threw on a document that vanished
      // between the read and the write, and the `catch` below swallows it as
      // the non-critical path this method already is.
      const { _id, ...rest } = doc;
      const result = await this.keyCollection.replaceOne({ _id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`API key not found: ${_id}`);
      }
    } catch (error) {
      // Non-critical -- log and swallow
      logger.error("Error touching API key lastUsedAt:", error);
    }
  }
}
