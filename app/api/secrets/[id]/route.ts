import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { isDatabaseConfigured, config } from "@/lib/config";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { z } from "zod";

function getSecretStore() {
  if (isDatabaseConfigured() && env.SECRET_ENCRYPTION_KEY) {
    return new SecretStore();
  }
  return null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsedId = z.string().min(1).max(128).safeParse(id);
    if (!parsedId.success) return api.badRequest("Invalid secret id");

    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const rateLimit = await checkRateLimit(request, {
      namespace: "secrets_write",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Too many secret write requests. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const secretStore = getSecretStore();
    if (!secretStore)
      return api.serviceUnavailable("Secret store not configured");

    const success = await secretStore.deleteSecret(parsedId.data, user.id);

    if (!success) {
      return api.notFound("Secret not found or could not be deleted");
    }

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete secret");
  }
}
