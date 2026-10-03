import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { store } from "@/lib/store";
import { api, handleError } from "@/lib/api-utils";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { getConfigCollection } from "@/lib/mongodb/client";
import { hydrateDocument, type ConfigDocument } from "@/lib/mongodb/common";
import type { ArenaMetadata, ArenaResponse } from "@/lib/types";

export const runtime = "nodejs";

const voteSchema = z.object({
  threadId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  winnerId: z.string().max(120).nullable(), // model ID or null for tie/skip
  votes: z
    .record(z.string(), z.enum(["like", "dislike"]).nullable())
    .optional(),
});

// Simple Elo calculation
function calculateElo(
  winnerRating: number,
  loserRating: number,
  K = 32,
): { winnerNew: number; loserNew: number } {
  const expectedWinner =
    1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 - expectedWinner;

  return {
    winnerNew: Math.round(winnerRating + K * (1 - expectedWinner)),
    loserNew: Math.round(loserRating + K * (0 - expectedLoser)),
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(req, {
      namespace: "arena_vote",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const parsed = voteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return api.badRequest(
        parsed.error.issues[0]?.message || "Invalid request",
      );
    }

    const { threadId, messageId, winnerId, votes } = parsed.data;

    // Verify thread ownership
    const thread = await store.getThread(threadId);
    if (!thread) {
      return api.notFound("Thread");
    }
    if (thread.userId !== user.id) {
      return api.forbidden();
    }

    // Find the message using store (resolves the thread scope)
    const messages = await store.getMessages(threadId);
    const message = messages.find((m) => m.id === messageId);

    if (!message) {
      return api.notFound("Message");
    }

    if (!message.arenaMetadata?.isArena) {
      return api.badRequest("Message is not an arena comparison");
    }

    // Update arena metadata with vote
    const updatedArenaMetadata = {
      ...message.arenaMetadata,
      winnerId,
      votedAt: new Date().toISOString(),
    };

    // Apply individual model votes if provided
    if (votes) {
      updatedArenaMetadata.responses = updatedArenaMetadata.responses.map(
        (r: ArenaResponse) => ({
          ...r,
          feedback: votes[r.modelId] !== undefined ? (votes[r.modelId] ?? undefined) : r.feedback,
        }),
      );
    }

    // If winner was picked, update the main content to the winner's response
    let contentUpdate: Partial<typeof message> = {};
    if (winnerId) {
      const winnerResponse = updatedArenaMetadata.responses.find(
        (r: ArenaResponse) => r.modelId === winnerId,
      );
      if (winnerResponse) {
        contentUpdate = {
          content: winnerResponse.content,
          model: winnerResponse.modelId,
          tokens: winnerResponse.tokens?.prompt
            ? winnerResponse.tokens
            : undefined,
        };
      }
    }

    // Save updated message using ChatHistoryStore (resolves the thread scope)
    const { ChatHistoryStore } = await import(
      "@/lib/mongodb/chat-history-store"
    );
    const { isDatabaseConfigured } = await import("@/lib/mongodb/client");

    if (isDatabaseConfigured()) {
      const chatHistoryStore = new ChatHistoryStore();
      await chatHistoryStore.updateMessageArenaVote(
        threadId,
        messageId,
        updatedArenaMetadata,
        contentUpdate,
      );
    }

    // Update leaderboard (fire-and-forget)
    updateLeaderboard(user.id, updatedArenaMetadata, winnerId).catch((err) =>
      logger.error({ err }, "Failed to update arena leaderboard"),
    );

    return api.success({ success: true, winnerId });
  } catch (error) {
    logger.error({ err: error }, "Arena vote error");
    return handleError(error, "Arena vote");
  }
}

async function updateLeaderboard(
  userId: string,
  arenaMetadata: ArenaMetadata,
  winnerId: string | null,
) {
  const collection = getConfigCollection();
  const leaderboardId = `arena-leaderboard-${userId}`;

  // Try to read existing leaderboard
  let leaderboard: ConfigDocument | null = null;
  try {
    // The Cosmos partition key becomes the `userId` predicate, and `type`
    // keeps whatever else the shared `config` collection holds out of the
    // read. `findOne` returns `null` where `item().read()` threw.
    const raw = await collection.findOne({
      _id: leaderboardId,
      userId,
      type: "arena_leaderboard",
    });
    if (raw) leaderboard = hydrateDocument(raw);
  } catch {
    // Doesn't exist yet
  }

  if (!leaderboard) {
    leaderboard = {
      id: leaderboardId,
      userId,
      type: "arena_leaderboard",
      entries: {},
      updatedAt: new Date().toISOString(),
    };
  }

  const entries = leaderboard.entries || {};

  // Initialize entries for models in this arena
  for (const response of arenaMetadata.responses) {
    if (!entries[response.modelId]) {
      entries[response.modelId] = {
        modelId: response.modelId,
        modelName: response.modelName,
        provider: response.provider,
        eloRating: 1200,
        totalVotes: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        avgLatencyMs: response.latencyMs,
      };
    }

    // Update average latency
    const entry = entries[response.modelId];
    entry.avgLatencyMs = Math.round(
      (entry.avgLatencyMs * entry.totalVotes + response.latencyMs) /
        (entry.totalVotes + 1),
    );
    entry.totalVotes += 1;
  }

  if (winnerId) {
    // Winner/loser Elo updates
    const winnerEntry = entries[winnerId];
    if (winnerEntry) {
      winnerEntry.wins += 1;

      for (const response of arenaMetadata.responses) {
        if (response.modelId !== winnerId && entries[response.modelId]) {
          const loserEntry = entries[response.modelId];
          loserEntry.losses += 1;

          const { winnerNew, loserNew } = calculateElo(
            winnerEntry.eloRating,
            loserEntry.eloRating,
          );
          winnerEntry.eloRating = winnerNew;
          loserEntry.eloRating = loserNew;
        }
      }
    }
  } else {
    // Tie — small Elo adjustments
    const modelIds = arenaMetadata.responses.map((r: ArenaResponse) => r.modelId);
    for (const id of modelIds) {
      if (entries[id]) {
        entries[id].ties += 1;
      }
    }
  }

  leaderboard.entries = entries;
  leaderboard.updatedAt = new Date().toISOString();

  try {
    // The upsert filter's `_id` equality is what seeds the inserted document's
    // `_id`; the replacement carries none (and no stored partition-key field —
    // that was Cosmos's, now the plain `userId` above). No `matchedCount`
    // guard: an upsert always matches or creates.
    await collection.replaceOne({ _id: leaderboardId }, leaderboard, {
      upsert: true,
    });
  } catch (err) {
    logger.error({ err }, "Failed to upsert arena leaderboard");
  }
}
