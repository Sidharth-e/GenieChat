import { NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { UserStore } from "@/lib/mongodb/user-store";
import { requirePermission, isNextResponse } from "@/lib/rbac/guards";
import { isValidRole } from "@/lib/rbac/permissions";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const userStore = isDatabaseConfigured() ? new UserStore() : null;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const result = await requirePermission("users:manage");
    if (isNextResponse(result)) return result;
    if (!userStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "admin_write",
      identifier: result.id,
      ...config.rateLimit.strict,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id: targetUserId } = await params;
    const body = await request.json();

    if (!body.role || !isValidRole(body.role)) {
      return api.badRequest("Invalid role. Must be one of: admin, manager, member, viewer");
    }

    if (targetUserId === result.id && body.role !== "admin") {
      return api.badRequest("You cannot demote yourself");
    }

    const updated = await userStore.updateUserRole(targetUserId, body.role);
    if (!updated) return api.notFound("User");

    return api.success(updated);
  } catch (error) {
    return handleError(error, "Update user role");
  }
}
