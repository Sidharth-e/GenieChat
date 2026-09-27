import { Collection } from "mongodb";
import { getWebhooksCollection, getWebhookInvocationsCollection } from "./client";
import { Webhook, WebhookInvocation } from "../types";
import {
  WebhookDocument,
  WebhookInvocationDocument,
  WithMongoId,
  hydrateDocument,
} from "./common";
import { generateId } from "../utils";
import { encrypt, decrypt } from "../crypto";
import { logger } from "@/lib/logger";

const INVOCATION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Webhooks and invocations share one collection (as they did under Cosmos,
// where one container held both), discriminated by `type` -- which is why every
// query below carries a `type` predicate. Two typed accessors over that
// collection keep `hydrateDocument` sound on both shapes.
export class WebhookStore {
  private webhooksCollection: Collection<WithMongoId<WebhookDocument>>;
  private invocationsCollection: Collection<WithMongoId<WebhookInvocationDocument>>;

  constructor() {
    this.webhooksCollection = getWebhooksCollection();
    this.invocationsCollection = getWebhookInvocationsCollection();
  }

  async create(
    webhook: Omit<Webhook, "id" | "secret" | "createdAt" | "updatedAt">,
  ): Promise<{ webhook: Webhook; rawSecret: string }> {
    const { randomBytes } = await import("crypto");
    const rawSecret = randomBytes(32).toString("hex");
    const now = new Date().toISOString();
    const id = generateId();

    const doc: WithMongoId<WebhookDocument> = {
      ...webhook,
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the `lib/types.ts` shape intact.
      _id: id,
      type: "webhook",
      secret: encrypt(rawSecret),
      createdAt: now,
      updatedAt: now,
    };

    await this.webhooksCollection.insertOne(doc);
    const result = hydrateDocument(doc);
    result.secret = "";
    return { webhook: result, rawSecret };
  }

  async getById(id: string, userId: string): Promise<Webhook | null> {
    // `userId` is the ownership check Cosmos performed through its partition
    // key, and `type` is the collection's discriminator.
    const doc = await this.webhooksCollection.findOne({
      _id: id,
      userId,
      type: "webhook",
    });

    if (!doc) return null;
    const result = hydrateDocument(doc);
    result.secret = "";
    return result;
  }

  async getByUserId(userId: string): Promise<Webhook[]> {
    const docs = await this.webhooksCollection
      .find({ userId, type: "webhook" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => {
      const result = hydrateDocument(doc);
      result.secret = "";
      return result;
    });
  }

  async getByIdForTrigger(id: string): Promise<(Webhook & { secret: string }) | null> {
    // No `userId` predicate: Cosmos queried this one without a partition key
    // (a cross-partition query), because the caller is an inbound webhook that
    // has no session to name a user. The absent predicate is safe only because
    // of what the caller does next, not because of anything here: the trigger
    // route compares the presented secret against the decrypted secret with a
    // timing-safe comparison and answers 404 on a mismatch
    // (`app/api/webhooks/[id]/trigger/route.ts`). The id is an address, NOT a
    // credential -- knowing it authorizes nothing.
    //
    // This method returns the *decrypted* secret, so any new caller must gate on
    // that signature check before trusting the returned value. Calling it to
    // render, list, or otherwise expose a webhook without verifying the caller's
    // secret would disclose the secret itself.
    const doc = await this.webhooksCollection.findOne({
      _id: id,
      type: "webhook",
    });

    if (!doc) return null;
    const result = hydrateDocument(doc);
    result.secret = decrypt(doc.secret);
    return result;
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<Pick<Webhook, "name" | "description" | "target" | "enabled">>,
  ): Promise<Webhook | null> {
    const existing = await this.getByIdRaw(id, userId);
    if (!existing) return null;

    const updated: WithMongoId<WebhookDocument> = {
      ...existing,
      ...updates,
      // Re-asserted after the caller's spread, so a body cannot re-own the
      // webhook or move it in a listing.
      userId: existing.userId,
      type: "webhook",
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Cosmos replaced through `item(id, userId).replace(resource)`, which threw
    // when the document had vanished since the read above; `matchedCount`
    // restores that throw, and this method never caught it either way.
    // The filter comes from the read, not the merge.
    const { _id, ...rest } = updated;
    const result = await this.webhooksCollection.replaceOne({ _id: existing._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Webhook not found: ${_id}`);
    }

    const hydrated = hydrateDocument(updated);
    hydrated.secret = "";
    return hydrated;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = await this.getByIdRaw(id, userId);
    if (!existing) return false;

    // No `matchedCount` guard: the read above already established the document
    // exists, so this is the same blind delete Cosmos's `item().delete()` was,
    // and the `false` return is the not-found branch's, not the delete's.
    await this.webhooksCollection.deleteOne({ _id: id, userId });
    await this.deleteInvocationsByWebhookId(id, userId);
    return true;
  }

  async rotateSecret(id: string, userId: string): Promise<string | null> {
    const existing = await this.getByIdRaw(id, userId);
    if (!existing) return null;

    const { randomBytes } = await import("crypto");
    const rawSecret = randomBytes(32).toString("hex");

    const updated: WithMongoId<WebhookDocument> = {
      ...existing,
      secret: encrypt(rawSecret),
      updatedAt: new Date().toISOString(),
    };

    // Same `matchedCount` guard as `update`: Cosmos's `replace` throws on a
    // document that vanished between the read and the write.
    // The filter names the read document; this replacement is store-computed
    // (`secret` is rotated here), so no identity field needs re-asserting.
    const { _id, ...rest } = updated;
    const result = await this.webhooksCollection.replaceOne({ _id: existing._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Webhook not found: ${_id}`);
    }

    return rawSecret;
  }

  async updateLastTriggered(id: string, userId: string): Promise<void> {
    const existing = await this.getByIdRaw(id, userId);
    if (!existing) return;

    const updated: WithMongoId<WebhookDocument> = {
      ...existing,
      lastTriggeredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Same `matchedCount` guard as `update`.
    // The filter comes from the read, not the merge: only `lastTriggeredAt`
    // and `updatedAt` are set above, so nothing needs re-asserting.
    const { _id, ...rest } = updated;
    const result = await this.webhooksCollection.replaceOne({ _id: existing._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Webhook not found: ${_id}`);
    }
  }

  async createInvocation(
    invocation: Omit<WebhookInvocation, "id">,
  ): Promise<WebhookInvocation> {
    const id = generateId();
    const doc: WithMongoId<WebhookInvocationDocument> = {
      ...invocation,
      id,
      _id: id,
      type: "webhook_invocation",
      // Replaces Cosmos's per-document `ttl`, which the service expired for us.
      // Mongo expires off a real `Date` against a TTL index with
      // `expireAfterSeconds: 0`, so this is deliberately a `Date` and not the
      // ISO string every other date on this document uses -- it is never read
      // or sorted by application code. `INVOCATION_TTL_SECONDS` is now a
      // multiplier rather than a stored field.
      expiresAt: new Date(Date.now() + INVOCATION_TTL_SECONDS * 1000),
    };

    await this.invocationsCollection.insertOne(doc);
    return hydrateDocument(doc);
  }

  async updateInvocation(
    id: string,
    userId: string,
    updates: Partial<Pick<WebhookInvocation, "status" | "executionId" | "error" | "completedAt" | "durationMs">>,
  ): Promise<void> {
    const existing = await this.invocationsCollection.findOne({
      _id: id,
      userId,
      type: "webhook_invocation",
    });

    if (!existing) return;

    const updated: WithMongoId<WebhookInvocationDocument> = {
      ...existing,
      ...updates,
      // Re-asserted after the caller's spread. `WebhookInvocationDocument` has
      // no `createdAt` field, so only the two it declares are re-asserted.
      userId: existing.userId,
      type: "webhook_invocation",
    };

    // Same `matchedCount` guard as `update`: Cosmos's `replace` throws on a
    // document that vanished between the read and the write.
    // The filter comes from the read, not the merge.
    const { _id, ...rest } = updated;
    const result = await this.invocationsCollection.replaceOne({ _id: existing._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Webhook invocation not found: ${_id}`);
    }
  }

  async getInvocations(
    webhookId: string,
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<WebhookInvocation[]> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    // `OFFSET @offset LIMIT @limit` becomes `skip` then `limit`, in that order.
    const docs = await this.invocationsCollection
      .find({ webhookId, userId, type: "webhook_invocation" })
      .sort({ triggeredAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async deleteInvocationsByWebhookId(webhookId: string, userId: string): Promise<void> {
    // Cosmos's `SELECT c.id` becomes a `_id`-only projection: `_id` is already
    // the id, so nothing needs renaming before the delete.
    //
    // Kept as a read-then-delete-each loop rather than a single `deleteMany`
    // (which would delete the identical set in one round trip): Cosmos wrapped
    // each item delete in its own `try/catch`, so one bad invocation id did not
    // abort the sweep. `deleteMany` would make the whole sweep all-or-nothing
    // and, because `delete()` calls this without a `try/catch` of its own,
    // surface a failure as a throw out of `delete()` instead of `true`.
    const docs = await this.invocationsCollection
      .find(
        { webhookId, userId, type: "webhook_invocation" },
        { projection: { _id: 1 } },
      )
      .toArray();

    for (const doc of docs) {
      try {
        // `userId` stays, matching the partition key Cosmos addressed each item
        // by. Deletes take no `matchedCount` guard, because a Mongo `deleteOne`
        // that matches nothing returns `deletedCount: 0` and never throws, so
        // there is no throw here for a guard to reproduce. One divergence in
        // diagnostics follows, and only in diagnostics: Cosmos's `item().delete()`
        // threw a 404 when the item was already gone, which the `catch` below
        // logged as a warning, so a benign "already deleted" race used to leave a
        // log line that no longer appears. Genuine failures still throw and still
        // log identically.
        await this.invocationsCollection.deleteOne({
          _id: doc._id,
          userId,
        });
      } catch (error) {
        logger.warn({ err: error, invocationId: doc._id }, "Failed to delete invocation");
      }
    }
  }

  // The raw document (including `_id`), for update/delete: those address the
  // document by `_id` and need the untouched stored fields to replace against.
  private async getByIdRaw(
    id: string,
    userId: string,
  ): Promise<WithMongoId<WebhookDocument> | null> {
    return await this.webhooksCollection.findOne({
      _id: id,
      userId,
      type: "webhook",
    });
  }
}
