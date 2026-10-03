import { Collection } from "mongodb";
import { generateId } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { getArtifactsCollection } from "./client";
import { WithMongoId, ArtifactDocument, buildSearchFilter } from "./common";
import { presignGet } from "@/lib/storage";
import { isUserScopedKey, parseRef } from "@/lib/storage/ref";
import { STORAGE_TTL } from "@/constants/storage";
import {
  ArtifactType,
  ArtifactSummary,
  ArtifactDetail,
  CreateArtifactInput,
} from "@/lib/artifacts/types";

/**
 * Signs a stored ref for the browser.
 *
 * Signing happens here, on read, so the stored value stays a bare locator. On
 * success the caller gets a presigned `https` URL it renders directly.
 *
 * A ref this user does not own, or one that fails to sign, comes back
 * unchanged — and `artifact-card.tsx` recognises that and routes it through
 * `/api/storage/download?ref=…`, which re-checks ownership and 403s. The proxy
 * signs with the same `presignGet` this function calls, so the fallback is not
 * a way to survive a signing outage — signing is local, and fails identically
 * on both paths. It exists so a value that cannot be signed never reaches the
 * browser as a bare `s3://` ref.
 *
 * Async, so `toSummary` below awaits it. Deliberately does not throw: losing the
 * artifact entirely is worse than losing the direct-to-Garage shortcut.
 */
async function resolveArtifactUrl(ref: string, userId: string): Promise<string> {
  const parsed = parseRef(ref);
  if (!parsed) return ref;
  if (!isUserScopedKey(parsed.key, userId)) return ref;
  try {
    return await presignGet(ref, STORAGE_TTL.attachment);
  } catch {
    return ref;
  }
}

// Built from named fields, never a spread, so the driver's `_id` cannot leak
// into a summary -- no `hydrateDocument` step is needed here.
async function toSummary(doc: WithMongoId<ArtifactDocument>): Promise<ArtifactSummary> {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    url: await resolveArtifactUrl(doc.url, doc.userId),
    chatId: doc.chatId,
    createdAt: doc.createdAt,
  };
}

async function toDetail(doc: WithMongoId<ArtifactDocument>): Promise<ArtifactDetail> {
  return {
    ...(await toSummary(doc)),
    metadata: doc.metadata,
  };
}

export class ArtifactStore {
  private artifactsCollection: Collection<WithMongoId<ArtifactDocument>>;

  constructor() {
    this.artifactsCollection = getArtifactsCollection();
  }

  private async getDocument(
    userId: string,
    artifactId: string,
  ): Promise<WithMongoId<ArtifactDocument> | null> {
    // The Cosmos query was `WHERE c.id = @id AND c.userId = @userId` -- with no
    // `type` predicate, deliberately: `type` here is the artifact *kind*
    // (image/file/chart/...), not a collection discriminator, so adding one
    // would filter out every row.
    const doc = await this.artifactsCollection.findOne({
      _id: artifactId,
      userId,
    });

    return doc ?? null;
  }

  async getArtifacts(
    userId: string,
    search?: string,
    type?: ArtifactType,
  ): Promise<ArtifactSummary[]> {
    const filter: Record<string, unknown> = { userId };

    // `buildSearchFilter` returns `{ $or: [...] }`, which is the Mongo
    // equivalent of the single `CONTAINS(LOWER(c.title), @search)` condition the
    // Cosmos version appended to its condition list.
    if (search?.trim()) {
      Object.assign(filter, buildSearchFilter(search.trim(), ["title"]));
    }

    if (type) {
      filter.type = type;
    }

    const docs = await this.artifactsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return Promise.all(docs.map(toSummary));
  }

  /**
   * The content hashes of the scan codes already saved on a thread.
   *
   * Scan codes are written automatically on every stream, so regenerating a
   * message would otherwise store a second artifact for the same symbol.
   * Comparing hashes against what the thread already holds is what makes a
   * re-run idempotent.
   *
   * Deliberately not `getArtifacts`: that signs a URL per row, and this needs
   * one field from each.
   */
  async getScancodeHashes(
    userId: string,
    chatId: string,
  ): Promise<Set<string>> {
    const docs = await this.artifactsCollection
      .find(
        { userId, type: "scancode", chatId },
        { projection: { "metadata.scancodeHash": 1 } },
      )
      .toArray();

    const hashes = new Set<string>();
    for (const doc of docs) {
      const hash = doc.metadata?.scancodeHash;
      if (typeof hash === "string") {
        hashes.add(hash);
      }
    }
    return hashes;
  }

  async getArtifact(
    userId: string,
    artifactId: string,
  ): Promise<ArtifactDetail | null> {
    const doc = await this.getDocument(userId, artifactId);
    return doc ? toDetail(doc) : null;
  }

  async createArtifact(
    userId: string,
    input: CreateArtifactInput,
  ): Promise<ArtifactDetail> {
    const id = generateId();
    const doc: WithMongoId<ArtifactDocument> = {
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and delete in this layer addresses the document by,
      // while `id` keeps the `ArtifactSummary`/`Detail` shape intact.
      _id: id,
      userId,
      type: input.type,
      title: input.title,
      url: input.url,
      metadata: input.metadata,
      chatId: input.chatId,
      createdAt: new Date().toISOString(),
    };

    await this.artifactsCollection.insertOne(doc);
    return toDetail(doc);
  }

  async deleteArtifact(userId: string, artifactId: string): Promise<boolean> {
    try {
      const doc = await this.getDocument(userId, artifactId);
      if (!doc) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId` filter -- it was just applied to the read above and Cosmos's
      // `item(artifactId, userId).delete()` addressed the same document.
      await this.artifactsCollection.deleteOne({ _id: artifactId });
      return true;
    } catch (error) {
      logger.error("Error deleting artifact:", error);
      return false;
    }
  }
}
