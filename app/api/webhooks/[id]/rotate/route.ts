import { NextRequest } from "next/server";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "webhooks_write",
      identifier: user.id,
      ...config.rateLimit.strict,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const { id } = await params;
    const rawSecret = await webhookStore.rotateSecret(id, user.id);

    if (!rawSecret) return api.notFound("Webhook");

    return api.success({ rawSecret });
  } catch (error) {
    return handleError(error, "Rotate webhook secret");
  }
}
