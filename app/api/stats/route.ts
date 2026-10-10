import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { windowStartIso } from "@/lib/stats";
import type { HomeStats } from "@/lib/types";

const chatHistoryStore = isDatabaseConfigured() ? new ChatHistoryStore() : null;
const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

/**
 * The home screen's own usage totals.
 *
 * Session-scoped, and every read is filtered by the session's `userId` -- there
 * is no cross-tenant view here and no RBAC gate, because there is nothing to
 * gate: the response describes the caller alone.
 *
 * Agent counts are deliberately absent. The home screen already loads the full
 * agent list for the composer's `@`-mention lookup, so tallying them
 * server-side would repeat a query the page has made anyway.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!chatHistoryStore || !artifactStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const windowStart = windowStartIso(new Date());

    const [usage, artifactTotal, artifactThisWeek] = await Promise.all([
      chatHistoryStore.getUsageOverview(user.id, windowStart),
      artifactStore.countArtifacts(user.id),
      artifactStore.countArtifacts(user.id, windowStart),
    ]);

    const stats: HomeStats = {
      threads: { ...usage.threads, activeThisWeek: usage.activeThisWeek },
      tokens: usage.tokens,
      artifacts: { total: artifactTotal, thisWeek: artifactThisWeek },
    };

    return api.success(stats);
  } catch (error) {
    return handleError(error, "Get home stats");
  }
}
