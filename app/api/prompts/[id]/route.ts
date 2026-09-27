import { NextRequest } from "next/server";
import { PromptStore } from "@/lib/mongodb/prompt-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const promptStore = isDatabaseConfigured() ? new PromptStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!promptStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const prompt = await promptStore.getPrompt(id, user.id);

    if (!prompt) return api.notFound("Prompt");
    if (prompt.userId !== user.id) return api.forbidden();

    return api.success(prompt);
  } catch (error) {
    return handleError(error, "Fetch prompt");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!promptStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "prompts_write",
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
    const existingPrompt = await promptStore.getPrompt(id, user.id);
    if (!existingPrompt) return api.notFound("Prompt");

    const body = await request.json();

    // Handle favorite actions (allowed for any prompt visible to the user)
    if (body.action === "favorite" || body.action === "unfavorite") {
      const canAccessPrompt =
        existingPrompt.userId === user.id ||
        existingPrompt.shareMode === "public" ||
        (existingPrompt.sharedWith ?? []).some(
          (sharedUser) => sharedUser.id === user.id,
        );
      if (!canAccessPrompt) return api.forbidden();

      const updatedPrompt = await promptStore.setPromptFavorite(
        id,
        user.id,
        body.action === "favorite",
      );
      if (!updatedPrompt) return api.serverError("Failed to update favorite");

      return api.success(updatedPrompt);
    }

    // Handle sharing actions
    if (body.action === "share" || body.action === "unshare") {
      if (existingPrompt.userId !== user.id) return api.forbidden();

      const result = await promptStore.toggleSharePrompt(
        id,
        body.action === "share",
        body.shareMode,
        body.sharedWith,
      );
      if (!result) return api.serverError("Failed to update prompt sharing");
      return api.success(result);
    }

    if (existingPrompt.userId !== user.id) return api.forbidden();

    const updates = { ...body };
    if (body.content) {
      const variableMatches = body.content.match(/\{\{(\w+)\}\}/g) || [];
      updates.variables = variableMatches.map((v: string) =>
        v.replace(/[{}]/g, ""),
      );
    }

    const updatedPrompt = await promptStore.updatePrompt(id, updates, user.id);
    if (!updatedPrompt) return api.notFound("Prompt");

    return api.success(updatedPrompt);
  } catch (error) {
    return handleError(error, "Update prompt");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!promptStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "prompts_write",
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
    const existingPrompt = await promptStore.getPrompt(id);

    if (!existingPrompt) return api.notFound("Prompt");
    if (existingPrompt.userId !== user.id) return api.forbidden();

    const deleted = await promptStore.deletePrompt(id);

    if (!deleted) return api.notFound("Prompt");

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete prompt");
  }
}
