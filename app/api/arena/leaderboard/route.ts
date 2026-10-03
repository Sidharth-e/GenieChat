import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { getConfigCollection } from "@/lib/mongodb/client";
import { hydrateDocument } from "@/lib/mongodb/common";
import type { ArenaLeaderboardEntry } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const collection = getConfigCollection();
    const leaderboardId = `arena-leaderboard-${user.id}`;

    let entries: ArenaLeaderboardEntry[] = [];

    try {
      // Cosmos addressed this document by `(id, partition key)`; the partition
      // key becomes the `userId` equality predicate it always was, and the
      // `type` conjunct keeps whatever else the shared `config` collection
      // holds from being read as a leaderboard. `findOne` returns `null` where
      // `item().read()` threw, so absence arrives as a value below.
      const raw = await collection.findOne({
        _id: leaderboardId,
        userId: user.id,
        type: "arena_leaderboard",
      });
      const doc = raw ? hydrateDocument(raw) : null;

      if (doc?.entries) {
        entries = Object.values(doc.entries);
        // Sort by Elo rating descending
        entries.sort((a, b) => b.eloRating - a.eloRating);
      }
    } catch {
      // No leaderboard yet — return empty
    }

    return api.success({ entries });
  } catch (error) {
    logger.error({ err: error }, "Arena leaderboard error");
    return handleError(error, "Arena leaderboard");
  }
}
