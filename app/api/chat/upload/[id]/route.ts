import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { deleteObject } from "@/lib/storage";
import { isUserScopedKey, parseRef } from "@/lib/storage/ref";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

export async function DELETE(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();

        const rateLimit = await checkRateLimit(request, {
            namespace: "upload_write",
            identifier: user.id,
            ...config.rateLimit.medium,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const { searchParams } = new URL(request.url);
        const ref = searchParams.get("ref");

        if (!ref) return api.badRequest("ref is required");

        const parsed = parseRef(ref);
        if (!parsed) return api.badRequest("Invalid storage reference");
        if (!isUserScopedKey(parsed.key, user.id)) return api.forbidden();

        logger.info(`[ChatUploadDelete] Deleting ${ref}`);
        const deleteResult = await deleteObject(ref);

        if (deleteResult.status !== "OK") {
            logger.error({ err: deleteResult }, "[ChatUploadDelete] Delete failed");
            return api.serverError("Failed to delete file");
        }

        logger.info(`[ChatUploadDelete] Successfully deleted: ${ref}`);
        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete uploaded file");
    }
}
