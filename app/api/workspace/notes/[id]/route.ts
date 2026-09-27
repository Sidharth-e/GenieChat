import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { WorkspaceNoteStore } from "@/lib/mongodb/note-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const noteStore = isDatabaseConfigured() ? new WorkspaceNoteStore() : null;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!noteStore) return api.serviceUnavailable("Database not configured");

    const { id } = await params;
    const note = await noteStore.getNote(user.id, id);
    if (!note) return api.notFound("Note");

    return api.success(note);
  } catch (error) {
    return handleError(error, "Fetch note");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!noteStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "notes_write",
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
    const body = await request.json();
    const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
    const hasContent = Object.prototype.hasOwnProperty.call(body, "content");

    if (!hasTitle && !hasContent) {
      return api.badRequest("Nothing to update");
    }

    if (hasTitle && body.title != null && typeof body.title !== "string") {
      return api.badRequest("Title must be a string");
    }

    if (hasContent && body.content != null && typeof body.content !== "string") {
      return api.badRequest("Content must be a string");
    }

    const updatedNote = await noteStore.updateNote(user.id, id, {
      title: hasTitle ? (body.title ?? "") : undefined,
      content: hasContent ? (body.content ?? "") : undefined,
    });
    if (!updatedNote) return api.notFound("Note");

    return api.success(updatedNote);
  } catch (error) {
    return handleError(error, "Update note");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!noteStore) return api.serviceUnavailable("Database not configured");

    const rateLimit = await checkRateLimit(request, {
      namespace: "notes_write",
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
    const deleted = await noteStore.deleteNote(user.id, id);
    if (!deleted) return api.notFound("Note");

    return api.success({ success: true });
  } catch (error) {
    return handleError(error, "Delete note");
  }
}
