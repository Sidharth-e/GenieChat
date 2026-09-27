import { NextRequest } from "next/server";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!webhookStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;

    // Verify webhook belongs to user
    const webhook = await webhookStore.getById(id, user.id);
    if (!webhook) return api.notFound("Webhook");

    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
      100,
    );
    const offset = Math.max(
      parseInt(searchParams.get("offset") || "0", 10) || 0,
      0,
    );

    const invocations = await webhookStore.getInvocations(id, user.id, {
      limit,
      offset,
    });

    return api.success(invocations);
  } catch (error) {
    return handleError(error, "Fetch webhook invocations");
  }
}
