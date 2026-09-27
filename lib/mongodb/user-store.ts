import { logger } from "@/lib/logger";
import { Collection, type WithId } from "mongodb";
import { getUsersCollection } from "./client";
import { UserDocument, buildSearchFilter } from "./common";
import { Role } from "../rbac/types";

export interface UserRecord {
  id: string;
  userId: string;
  email: string;
  name: string;
  image?: string | null;
  role: Role;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * `UserDocument` declares `_id` and no `id`, so `hydrateDocument` does not apply
 * here -- `getUsersCollection()` is `Collection<UserDocument>` rather than
 * `WithMongoId`-wrapped, and hydrating is guarded against a type that already
 * carries `_id`. This is the store's own one-line mapping, used by every read
 * path in place of Cosmos's `stripDocumentFields`, and it keeps `type` on the
 * returned object exactly as `hydrateDocument` does for every other store (R32).
 * That is a deliberate divergence from the Cosmos helper, which stripped the
 * discriminator: `UserRecord` does not declare the field, but the spread is
 * exempt from the excess-property check a literal would fail, so carrying it
 * costs nothing and keeps one consistent read shape across the port.
 */
export function toUserRecord(doc: WithId<UserDocument>): UserRecord {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id };
}

export class UserStore {
  private userCollection: Collection<UserDocument>;

  constructor() {
    this.userCollection = getUsersCollection();
  }

  async upsertUser(user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    role: Role;
  }): Promise<UserRecord> {
    const now = new Date().toISOString();
    const existing = await this.getUserDocument(user.id);

    // Read-then-branch, as in Cosmos -- deliberately not a single literal with
    // `upsert: true`, which replaces the whole document and would reset
    // `createdAt` on every sign-in, overwrite an admin-assigned `role` with
    // whatever the sign-in token carried, and wipe the avatar. This branch
    // preserves `createdAt` and `role` by spreading `{...existing}` and only
    // refreshes the identity fields plus the login timestamps.
    if (existing) {
      const updated: UserDocument = {
        ...existing,
        email: user.email,
        name: user.name,
        image: user.image,
        lastLoginAt: now,
        updatedAt: now,
      };
      const { _id, ...rest } = updated;
      // No `upsert: true` here either: Cosmos's `item(id, id).replace(...)`
      // throws on a missing document rather than recreating one, and this
      // method has no `try/catch`, so a concurrent delete propagates to the
      // caller. `matchedCount` restores that throw; an upsert would instead
      // silently resurrect a deleted user.
      // The filter comes from the read, not the merge. `email`, `name` and
      // `image` do come from the caller, but none of them is an identity
      // field, so this replacement needs no re-assertion.
      const result = await this.userCollection.replaceOne({ _id: existing._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`User not found: ${_id}`);
      }
      return toUserRecord(updated);
    }

    const newDoc: UserDocument = {
      _id: user.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      type: "user",
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await this.userCollection.insertOne(newDoc);
    return toUserRecord(newDoc);
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const doc = await this.getUserDocument(userId);
    return doc ? toUserRecord(doc) : null;
  }

  async getAllUsers(): Promise<UserRecord[]> {
    // The admin user listing: unfiltered by user, and with no limit, exactly as
    // the Cosmos query was.
    const docs = await this.userCollection
      .find({ type: "user" })
      .sort({ lastLoginAt: -1 })
      .toArray();

    return docs.map((doc) => toUserRecord(doc));
  }

  /**
   * Directory search for the share picker. Unlike `getAllUsers` -- the
   * unfiltered admin listing, which belongs behind an RBAC gate -- this matches
   * in the database and returns at most `limit` rows rather than the whole
   * collection, so a two-character query cannot pull the directory across the
   * wire. Ordered as `getAllUsers` is, so the picker shows the most recently
   * active matches first rather than an arbitrary subset. Deliberately not
   * scoped by `userId`: a directory search is cross-user by definition, and the
   * caller bounds what it can return.
   */
  async searchUsers(term: string, limit: number): Promise<UserRecord[]> {
    const filter: Record<string, unknown> = { type: "user" };
    Object.assign(filter, buildSearchFilter(term, ["name", "email"]));

    const docs = await this.userCollection
      .find(filter)
      .sort({ lastLoginAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => toUserRecord(doc));
  }

  async updateUserRole(userId: string, role: Role): Promise<UserRecord | null> {
    try {
      const existing = await this.getUserDocument(userId);
      if (!existing) return null;

      const updated: UserDocument = {
        ...existing,
        role,
        updatedAt: new Date().toISOString(),
      };

      const { _id, ...rest } = updated;
      // Cosmos's `item(userId, userId).replace(...)` threw when the document
      // had been deleted since the read above; `matchedCount` restores that,
      // and the `catch` below turns it into the `null` a missing user returns.
      // The filter comes from the read, not the merge. `role` is caller-
      // supplied but is not an identity field, so this replacement needs no
      // re-assertion.
      const result = await this.userCollection.replaceOne({ _id: existing._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`User not found: ${_id}`);
      }

      return toUserRecord(updated);
    } catch (error) {
      logger.error("Error updating user role:", error);
      return null;
    }
  }

  private async getUserDocument(
    userId: string,
  ): Promise<WithId<UserDocument> | null> {
    try {
      // Cosmos read this document through the item path keyed by `userId`,
      // which holds the same value as `_id` here. Its 404 branch has no Mongo
      // counterpart -- `findOne` returns null for a miss on its own -- so only
      // a genuine fault reaches the `catch`, which logs and returns null as the
      // Cosmos helper did.
      return await this.userCollection.findOne({ _id: userId });
    } catch (error) {
      logger.error("Error reading user document:", error);
      return null;
    }
  }
}
