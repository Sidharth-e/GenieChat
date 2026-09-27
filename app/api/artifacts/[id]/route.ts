import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!artifactStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const artifact = await artifactStore.getArtifact(user.id, id);
    if (!artifact) return api.notFound("Artifact");

    return api.success(artifact);
  } catch (error) {
    return handleError(error, "Fetch artifact");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const { id } = await params;
    const deleted = await artifactStore.deleteArtifact(user.id, id);
    if (!deleted) return api.notFound("Artifact");

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete artifact");
  }
}
