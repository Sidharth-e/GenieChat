import { NextRequest } from "next/server";
import { ApiKeyStore } from "@/lib/mongodb/api-key-store";
import { ApiKey } from "@/lib/types";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { logger } from "@/lib/logger";

export interface ApiAuthResult {
  authenticated: boolean;
  apiKey?: ApiKey;
  error?: string;
}

const keyStore = isDatabaseConfigured() ? new ApiKeyStore() : null;

/**
 * Authenticate a request using a Bearer token (API key).
 * Expects: `Authorization: Bearer sk-ag-...`
 */
export async function authenticateApiKey(req: NextRequest): Promise<ApiAuthResult> {
  // 1. Check keyStore is available
  if (!keyStore) return { authenticated: false, error: "API keys service unavailable" };

  // 2. Extract Bearer token from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { authenticated: false, error: "Missing or invalid Authorization header" };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey || !rawKey.startsWith("sk-ag-")) {
    return { authenticated: false, error: "Invalid API key format" };
  }

  // 3. Hash the key and look it up
  try {
    const hash = ApiKeyStore.hashKey(rawKey);
    const apiKey = await keyStore.findByHash(hash);

    if (!apiKey) {
      return { authenticated: false, error: "Invalid or expired API key" };
    }

    // Fire-and-forget: update lastUsedAt
    keyStore.touchKey(apiKey.id, apiKey.userId).catch(() => {});

    return { authenticated: true, apiKey };
  } catch (error) {
    logger.error("API key authentication error:", error);
    return { authenticated: false, error: "Authentication failed" };
  }
}

/**
 * Check if an API key has access to a specific agent.
 * Scopes can be ["*"] for all agents, or specific agent IDs.
 */
export function hasAgentAccess(apiKey: ApiKey, agentId: string): boolean {
  if (apiKey.scopes.includes("*")) return true;
  return apiKey.scopes.includes(agentId);
}
