import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { store } from "@/lib/store";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { z } from "zod";

export const runtime = "nodejs";

const feedbackSchema = z.object({
  threadId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  versionId: z.string().min(1).max(128),
  feedback: z.enum(["like", "dislike"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      logger.info("[Feedback] No user session found");
      return api.unauthorized();
    }

    const rateLimit = await checkRateLimit(req, {
      namespace: "feedback",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Too many feedback requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const parsed = feedbackSchema.safeParse(await req.json());
    if (!parsed.success) {
      return api.badRequest("Invalid feedback request payload");
    }

    const { threadId, messageId, versionId, feedback } = parsed.data;
    logger.info(
      `[Feedback] Request: threadId=${threadId}, messageId=${messageId}, versionId=${versionId}, feedback=${feedback}`,
    );

    logger.info(`[Feedback] Fetching thread ${threadId}`);
    const thread = await store.getThread(threadId);
    if (!thread) {
      logger.info(`[Feedback] Thread ${threadId} not found`);
      return api.notFound("Thread");
    }

    if (thread.userId !== user.id) {
      logger.info(
        `[Feedback] Thread forbidden. User ${user.id} != Thread User ${thread.userId}`,
      );
      return api.forbidden();
    }

    logger.info(`[Feedback] Fetching messages for thread ${threadId}`);
    const messages = await store.getMessages(threadId);
    const message = messages.find((m) => m.id === messageId);

    // Diagnostic / Not Found Handling
    if (!message) {
      logger.info(
        `[Feedback] Message ${messageId} not found in thread ${threadId}`,
      );
      return api.notFound("Message");
    }

    const { ChatHistoryStore } =
      await import("@/lib/mongodb/chat-history-store");
    const { isDatabaseConfigured } = await import("@/lib/mongodb/client");

    if (isDatabaseConfigured()) {
      logger.info("[Feedback] Database configured, updating stored message");
      const chatHistoryStore = new ChatHistoryStore();
      const success = await chatHistoryStore.updateMessageFeedback(
        threadId,
        messageId,
        versionId,
        feedback,
      );
      logger.info(
        `[Feedback] Database update result: ${success} for message ${messageId}`,
      );
      if (!success) {
        logger.info("[Feedback] Failed to update stored message");
        return api.serverError("Failed to update message feedback in database");
      }
    } else {
      logger.info(
        `[Feedback] In-memory: ${feedback} for message ${messageId} version ${versionId} in thread ${threadId}`,
      );
    }

    logger.info(
      `[Feedback] User ${user.id} gave '${feedback}' to message ${messageId} version ${versionId}`,
    );

    return api.success({ success: true, feedback, messageId });
  } catch (error) {
    logger.error({ err: error }, "[Feedback] Error handler caught");
    return handleError(error, "Save feedback");
  }
}
