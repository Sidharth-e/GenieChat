import { NextRequest } from "next/server";
import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  try {
    const rateLimit = await checkRateLimit(request, {
      namespace: "share_access",
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Too many requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { shareId } = await params;

    if (!shareId) return api.badRequest("Share ID is required");

    const store = new ChatHistoryStore();
    const { thread, accessDenied } = await store.getThreadByShareIdWithAccess(shareId);

    if (!thread) return api.notFound("Shared thread");

    if (accessDenied) {
      return api.forbidden();
    }

    const messages = await store.getMessages(thread.id);
    return api.success({ thread, messages });
  } catch (error) {
    return handleError(error, "Fetch shared thread");
  }
}
