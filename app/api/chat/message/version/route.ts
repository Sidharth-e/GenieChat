import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { api } from "@/lib/api-utils";
import { config } from "@/lib/config";

const updateVersionSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  activeVersionIndex: z.number().min(0),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = await checkRateLimit(req, {
      namespace: "chat_version_write",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const body = await req.json();
    const parsed = updateVersionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { threadId, messageId, activeVersionIndex } = parsed.data;

    // Verify thread ownership
    const thread = await store.getThread(threadId);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update message version
    const updatedMessage = await store.updateMessageActiveVersion(
      threadId,
      messageId,
      activeVersionIndex
    );

    if (!updatedMessage) {
      return NextResponse.json(
        { error: "Message not found or version index invalid" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: updatedMessage });
  } catch (error) {
    logger.error("Error updating message active version:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
