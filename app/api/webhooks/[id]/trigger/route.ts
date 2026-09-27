import { NextRequest } from "next/server";
import crypto from "crypto";
import { WebhookStore } from "@/lib/mongodb/webhook-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { executeWebhookTrigger } from "@/lib/webhook/webhook-execution-service";
import { logger } from "@/lib/logger";

const webhookStore = isDatabaseConfigured() ? new WebhookStore() : null;

const MAX_PAYLOAD_BYTES = 100 * 1024; // 100KB
const MAX_STORED_PAYLOAD_BYTES = 10 * 1024; // 10KB

interface RouteParams {
  params: Promise<{ id: string }>;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!webhookStore) return api.notFound();

    const { id } = await params;

    // Rate limit per webhook ID
    const rateLimit = await checkRateLimit(request, {
      namespace: "webhooks_trigger",
      identifier: id,
      ...config.rateLimit.strict,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    // Check payload size
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return api.error("Payload too large", 413);
    }

    // Read and validate payload
    let payload: Record<string, unknown>;
    try {
      const rawBody = await request.text();
      if (rawBody.length > MAX_PAYLOAD_BYTES) {
        return api.error("Payload too large", 413);
      }
      payload = JSON.parse(rawBody);
    } catch {
      return api.badRequest("Invalid JSON payload");
    }

    // Extract secret from Authorization header
    const authHeader = request.headers.get("authorization");
    const providedSecret = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!providedSecret) {
      // Return 404 to not reveal webhook existence
      return api.notFound();
    }

    // Fetch webhook (includes decrypted secret)
    const webhook = await webhookStore.getByIdForTrigger(id);

    if (!webhook || !webhook.enabled) {
      // Return 404 for disabled/missing webhooks
      return api.notFound();
    }

    // Timing-safe secret comparison
    const providedBuffer = Buffer.from(providedSecret, "utf-8");
    const expectedBuffer = Buffer.from(webhook.secret, "utf-8");

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      // Return 404 to not reveal webhook existence
      return api.notFound();
    }

    // Truncate payload for storage (store as-is if small, or truncated string if large)
    const payloadStr = JSON.stringify(payload);
    let storedPayload: Record<string, unknown>;
    if (payloadStr.length > MAX_STORED_PAYLOAD_BYTES) {
      storedPayload = {
        _truncated: true,
        _originalSize: payloadStr.length,
        _preview: payloadStr.slice(0, MAX_STORED_PAYLOAD_BYTES),
      };
    } else {
      storedPayload = payload;
    }

    // Create invocation record
    const sourceIp = getClientIp(request);
    const invocation = await webhookStore.createInvocation({
      webhookId: webhook.id,
      userId: webhook.userId,
      payload: storedPayload,
      headers: {
        "content-type": request.headers.get("content-type") || "",
        "user-agent": request.headers.get("user-agent") || "",
      },
      sourceIp,
      status: "pending",
      triggeredAt: new Date().toISOString(),
    });

    // Fire-and-forget execution
    void executeWebhookTrigger(webhook, invocation, payload);

    logger.info(
      { webhookId: webhook.id, invocationId: invocation.id },
      "Webhook triggered",
    );

    return api.success({ success: true, invocationId: invocation.id });
  } catch (error) {
    return handleError(error, "Trigger webhook");
  }
}
