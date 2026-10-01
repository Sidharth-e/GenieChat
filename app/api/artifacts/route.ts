import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";
import { isUserScopedKey, parseRef } from "@/lib/storage/ref";
import { ArtifactType } from "@/lib/artifacts/types";

const VALID_TYPES: ArtifactType[] = [
  "image",
  "file",
  "chart",
  "mermaid",
  "canvas",
  "code_sandbox",
];

const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!artifactStore) return api.serviceUnavailable("Database not configured");

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const typeParam = searchParams.get("type")?.trim() || "";
    const type = VALID_TYPES.includes(typeParam as ArtifactType)
      ? (typeParam as ArtifactType)
      : undefined;

    const artifacts = await artifactStore.getArtifacts(user.id, search, type);
    return api.success(artifacts);
  } catch (error) {
    return handleError(error, "Fetch artifacts");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!artifactStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "artifacts_write",
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
    const { type, title, url, metadata, chatId } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return api.badRequest(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`);
    }
    if (typeof title !== "string" || !title.trim()) {
      return api.badRequest("Title is required");
    }

    // The ref is a locator this route would sign on read, so a caller who does
    // not own it must not be able to store it: `resolveArtifactUrl` would hand
    // back a working presigned URL for someone else's object. A bare
    // `{bucket}/{key}` path fails here too, and correctly so — there was no
    // data migration, so no pre-branch value is a valid ref.
    const parsedUrl = typeof url === "string" ? parseRef(url) : null;
    if (!parsedUrl || !isUserScopedKey(parsedUrl.key, user.id)) {
      return api.badRequest("url must be a storage reference under your own user scope");
    }

    const artifact = await artifactStore.createArtifact(user.id, {
      type,
      title: title.trim(),
      url,
      metadata,
      chatId: typeof chatId === "string" ? chatId : undefined,
    });

    return api.created(artifact);
  } catch (error) {
    return handleError(error, "Create artifact");
  }
}
