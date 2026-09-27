import { NextRequest } from "next/server";
import { PromptStore } from "@/lib/mongodb/prompt-store";
import { api, handleError } from "@/lib/api-utils";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";

const promptStore = isDatabaseConfigured() ? new PromptStore() : null;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  try {
    if (!promptStore) return api.serviceUnavailable("Database not configured");

    const { shareId } = await params;
    if (!shareId) return api.badRequest("Share ID is required");

    const prompt = await promptStore.getPromptByShareId(shareId);

    if (!prompt) return api.notFound("Shared prompt");

    if (prompt.shareMode === "specific") {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) {
        return api.forbidden();
      }

      const userEmail = session.user.email.toLowerCase();
      const isOwner = prompt.userId === session.user.id;

      if (!isOwner) {
        const hasUserAccess =
          prompt.sharedWith?.some(
            (user) => user.email.toLowerCase() === userEmail,
          ) ?? false;

        if (!hasUserAccess) {
          return api.forbidden();
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { userId: _u, userEmail: _e, ...safePrompt } = prompt;
    return api.success(safePrompt);
  } catch (error) {
    return handleError(error, "Fetch shared prompt");
  }
}
