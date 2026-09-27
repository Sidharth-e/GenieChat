import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ApiKeyStore } from "@/lib/mongodb/api-key-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const keyStore = isDatabaseConfigured() ? new ApiKeyStore() : null;

// GET /api/agents/v1/keys — List all API keys for the user
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!keyStore) return api.serviceUnavailable("Database not configured");

    const keys = await keyStore.listKeys(user.id);
    // Never return keyHash to the client
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const safeKeys = keys.map(({ keyHash, ...rest }) => rest);
    return api.success(safeKeys);
  } catch (error) {
    return handleError(error, "List API keys");
  }
}

// POST /api/agents/v1/keys — Create a new API key
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!keyStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(req, {
      namespace: "api_keys_write",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const body = await req.json();
    const { name, scopes, expiresAt } = body;

    if (!name) return api.badRequest("name is required");

    const { apiKey, rawKey } = await keyStore.createKey({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      name,
      scopes: scopes || ["*"],
      expiresAt,
    });

    // Return raw key ONLY on creation — it is never retrievable again
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keyHash, ...safeKey } = apiKey;
    return api.created({ ...safeKey, key: rawKey });
  } catch (error) {
    return handleError(error, "Create API key");
  }
}

// DELETE /api/agents/v1/keys — Revoke an API key (pass `id` in query)
export async function DELETE(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!keyStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(req, {
      namespace: "api_keys_write",
      identifier: user.id,
      ...config.rateLimit.medium,
    });
    if (!rateLimit.allowed) {
      return api.tooManyRequests(
        `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
        rateLimit.retryAfterSeconds,
      );
    }

    const keyId = req.nextUrl.searchParams.get("id");
    if (!keyId) return api.badRequest("id query parameter is required");

    const revoked = await keyStore.revokeKey(keyId, user.id);
    if (!revoked) return api.notFound("API key");

    return api.success({ revoked: true });
  } catch (error) {
    return handleError(error, "Revoke API key");
  }
}
