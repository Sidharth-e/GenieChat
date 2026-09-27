import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { AnnouncementStore } from "@/lib/mongodb/announcement-store";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const announcementStore = isDatabaseConfigured() ? new AnnouncementStore() : null;

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!announcementStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const announcement = await announcementStore.getCurrentAnnouncement(user.id);
    return api.success(announcement);
  } catch (error) {
    return handleError(error, "Fetch announcement");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!announcementStore) {
      return api.serviceUnavailable("Database not configured");
    }

    const rateLimit = await checkRateLimit(request, {
      namespace: "announcements_write",
      identifier: user.id,
      ...config.rateLimit.standard,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const body = await request.json();
    const announcementId =
      typeof body?.announcementId === "string" ? body.announcementId : null;

    if (!announcementId) {
      return api.badRequest("announcementId is required");
    }

    const success = await announcementStore.markAnnouncementSeen(
      user.id,
      announcementId,
    );

    if (!success) {
      return api.badRequest("Invalid announcementId");
    }

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Update announcement");
  }
}
