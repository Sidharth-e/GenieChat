import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { WorkspaceNoteStore } from "@/lib/mongodb/note-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const noteStore = isDatabaseConfigured() ? new WorkspaceNoteStore() : null;

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!noteStore) return api.serviceUnavailable("Database not configured");

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";

    const notes = await noteStore.getNotes(user.id, search);

    return api.success(notes);
  } catch (error) {
    return handleError(error, "Fetch notes");
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const title = typeof body?.title === "string" ? body.title : "";
    const content = typeof body?.content === "string" ? body.content : "";

    if (!title.trim() && !content.trim()) {
      return api.badRequest("Title or content is required");
    }

    const note = await noteStore.createNote(user.id, {
      title: title.trim() || "Untitled",
      content: content || "<p></p>",
    });

    return api.created(note);
  } catch (error) {
    return handleError(error, "Create note");
  }
}
