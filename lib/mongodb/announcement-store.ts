import { Collection } from "mongodb";
import { ANNOUNCEMENTS, type Announcement } from "@/constants/announcements";
import { logger } from "@/lib/logger";
import { getConfigCollection } from "./client";
import { ConfigDocument, WithMongoId, hydrateDocument } from "./common";

/**
 * The Cosmos store declared its own private `AnnouncementStateDocument` for the
 * rows this class writes; `common.ts` already worked out that shape as
 * `ConfigDocument`, the base interface the mixed-type `config` collection's
 * announcement and arena documents share. Reading through it is what leaves
 * `seenAnnouncementIds` optional, as an arena leaderboard row never carries it.
 */
export class AnnouncementStore {
  private configCollection: Collection<WithMongoId<ConfigDocument>>;

  constructor() {
    this.configCollection = getConfigCollection();
  }

  private getDocumentId(userId: string) {
    return `announcement_state:${userId}`;
  }

  private async getStateDocument(
    userId: string,
  ): Promise<ConfigDocument | null> {
    try {
      // The Cosmos query was `WHERE c.id = @id AND c.userId = @userId AND
      // c.type = 'announcement_state'`. The `type` predicate is what keeps an
      // announcement row apart from the arena rows sharing this collection, so
      // it stays; the query's partition-key option has no Mongo counterpart and
      // is dropped.
      const doc = await this.configCollection.findOne({
        _id: this.getDocumentId(userId),
        userId,
        type: "announcement_state",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting announcement state:", error);
      return null;
    }
  }

  private createEmptyState(userId: string): ConfigDocument {
    const now = new Date().toISOString();
    // No `_id` key, deliberately: `ConfigDocument` declares none (the accessor's
    // `WithMongoId` supplies it), so an `_id` here would be an excess-property
    // error. The upsert filter in `markAnnouncementSeen` seeds the inserted
    // document's `_id` instead.
    return {
      id: this.getDocumentId(userId),
      type: "announcement_state",
      userId,
      seenAnnouncementIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async getCurrentAnnouncement(userId: string): Promise<Announcement | null> {
    const state = await this.getStateDocument(userId);
    // `seenAnnouncementIds` is optional on `ConfigDocument` -- the arena rows
    // omit it -- where the Cosmos interface declared it required, so the `?? []`
    // is what keeps this a `Set<string>` rather than a `Set<string | undefined>`.
    const seenIds = new Set(state?.seenAnnouncementIds ?? []);

    return (
      ANNOUNCEMENTS.find(
        (announcement) =>
          announcement.enabled !== false && !seenIds.has(announcement.id),
      ) ?? null
    );
  }

  async markAnnouncementSeen(
    userId: string,
    announcementId: string,
  ): Promise<boolean> {
    if (!ANNOUNCEMENTS.some((announcement) => announcement.id === announcementId)) {
      return false;
    }

    try {
      const existingState =
        (await this.getStateDocument(userId)) ?? this.createEmptyState(userId);
      // The `?? []` matters for the same reason as in `getCurrentAnnouncement`:
      // without it the inferred element type is `string | undefined` and
      // `Array.from` will not assign back to `string[]`.
      const seenIds = new Set(existingState.seenAnnouncementIds ?? []);
      seenIds.add(announcementId);

      const updatedState: ConfigDocument = {
        ...existingState,
        seenAnnouncementIds: Array.from(seenIds),
        updatedAt: new Date().toISOString(),
      };

      // Cosmos's `items.upsert(updatedState)` becomes an upserting
      // `replaceOne`. `upsert: true` is required rather than optional:
      // `existingState` may be a `createEmptyState` result that has never been
      // persisted, so this call genuinely creates on first use. The filter is
      // the document's address -- `_id` seeded from the deterministic
      // `announcement_state:${userId}` id, plus the owning `userId`, which is
      // embedded in that id and so cannot disagree with it. Mongo copies the
      // filter's equality fields onto the inserted document, which is why the
      // replacement carries no `_id`. No `matchedCount` guard: an upsert always
      // matches or creates, so `matchedCount` is 1 either way.
      await this.configCollection.replaceOne(
        { _id: this.getDocumentId(userId), userId },
        updatedState,
        { upsert: true },
      );
      return true;
    } catch (error) {
      logger.error("Error marking announcement as seen:", error);
      return false;
    }
  }
}
