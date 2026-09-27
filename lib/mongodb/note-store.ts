import { Collection } from "mongodb";
import { generateId } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { getNotesCollection } from "./client";
import { WithMongoId, NotesDocument, buildSearchFilter } from "./common";
import {
  CreateWorkspaceNoteInput,
  UpdateWorkspaceNoteInput,
  WorkspaceNoteDetail,
  WorkspaceNoteSummary,
} from "@/lib/notes/types";

// `NotesDocument` in `./common` is the Cosmos store's local
// `WorkspaceNoteDocument`, ported field for field; the store keeps addressing it
// under that name here.

function toTextPreview(content: string): string {
  const text = content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "No content";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

// Built from named fields, never a spread, so the driver's `_id` cannot leak
// into a summary -- no `hydrateDocument` step is needed here.
function toSummary(note: WithMongoId<NotesDocument>): WorkspaceNoteSummary {
  return {
    id: note.id,
    title: note.title || "Untitled",
    preview: toTextPreview(note.content),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toDetail(note: WithMongoId<NotesDocument>): WorkspaceNoteDetail {
  return {
    ...toSummary(note),
    content: note.content,
  };
}

export class WorkspaceNoteStore {
  private notesCollection: Collection<WithMongoId<NotesDocument>>;

  constructor() {
    this.notesCollection = getNotesCollection();
  }

  private async getNoteDocument(
    userId: string,
    noteId: string,
  ): Promise<WithMongoId<NotesDocument> | null> {
    // The Cosmos query was `WHERE c.id = @id AND c.userId = @userId AND
    // c.type = 'workspace_note'`; the id and type predicates collapse onto the
    // document key.
    const doc = await this.notesCollection.findOne({
      _id: noteId,
      userId,
      type: "workspace_note",
    });

    return doc ?? null;
  }

  async getNotes(userId: string, search?: string): Promise<WorkspaceNoteSummary[]> {
    const normalizedSearch = search?.trim() || "";

    const filter: Record<string, unknown> = {
      userId,
      type: "workspace_note",
    };

    // `buildSearchFilter` returns `{ $or: [...] }`, merged into the top-level
    // filter alongside `userId` and `type` -- which is exactly the
    // `(CONTAINS(title) OR CONTAINS(content))` grouping the Cosmos query
    // expressed. The old `.toLowerCase()` on the search term is dropped, since
    // the regex's `i` flag covers it.
    if (normalizedSearch) {
      Object.assign(filter, buildSearchFilter(normalizedSearch, ["title", "content"]));
    }

    const docs = await this.notesCollection
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    return docs.map(toSummary);
  }

  async getNote(userId: string, noteId: string): Promise<WorkspaceNoteDetail | null> {
    const note = await this.getNoteDocument(userId, noteId);
    return note ? toDetail(note) : null;
  }

  async createNote(
    userId: string,
    input: CreateWorkspaceNoteInput,
  ): Promise<WorkspaceNoteDetail> {
    const now = new Date().toISOString();
    const id = generateId();
    const note: WithMongoId<NotesDocument> = {
      id,
      // Mongo's mandatory key, holding the same generated value as `id`: `_id`
      // is what every read and update in this layer addresses the document by,
      // while `id` keeps the `WorkspaceNoteSummary`/`Detail` shape intact.
      _id: id,
      userId,
      type: "workspace_note",
      title: input.title.trim() || "Untitled",
      content: input.content || "<p></p>",
      createdAt: now,
      updatedAt: now,
    };

    await this.notesCollection.insertOne(note);
    return toDetail(note);
  }

  async updateNote(
    userId: string,
    noteId: string,
    updates: UpdateWorkspaceNoteInput,
  ): Promise<WorkspaceNoteDetail | null> {
    try {
      const existingNote = await this.getNoteDocument(userId, noteId);
      if (!existingNote) return null;

      const updatedNote: WithMongoId<NotesDocument> = {
        ...existingNote,
        ...(updates.title !== undefined
          ? { title: updates.title.trim() || "Untitled" }
          : {}),
        ...(updates.content !== undefined
          ? { content: updates.content || "<p></p>" }
          : {}),
        // Re-asserted after the caller's fields so a request body carrying these
        // keys cannot change the note's owner, kind or creation time.
        userId: existingNote.userId,
        type: existingNote.type,
        createdAt: existingNote.createdAt,
        updatedAt: new Date().toISOString(),
      };

      // Cosmos replaced through `item(noteId, userId).replace(updatedNote)`,
      // which throws when the document has vanished since the read;
      // `matchedCount` restores that, and the `catch` below turns it into the
      // same `null` the missing-document branch above returns. The filter is
      // built from the document just read, not from the merged one, whose `_id`
      // a caller-supplied `updates` object could otherwise retarget; `_id` is
      // dropped from the replacement because the driver's parameter is the
      // document without its key.
      const { _id, ...rest } = updatedNote;
      const result = await this.notesCollection.replaceOne(
        { _id: existingNote._id },
        rest,
      );
      if (result.matchedCount === 0) {
        throw new Error(`Note not found: ${_id}`);
      }

      return toDetail(updatedNote);
    } catch (error) {
      logger.error("Error updating note:", error);
      return null;
    }
  }

  async deleteNote(userId: string, noteId: string): Promise<boolean> {
    try {
      const existingNote = await this.getNoteDocument(userId, noteId);
      if (!existingNote) return false;

      // `_id` is a globally unique uuidv7, so the delete itself does not repeat
      // the `userId`/`type` filter -- both were just applied to the read above
      // and Cosmos's `item(noteId, userId).delete()` addressed the same
      // document.
      await this.notesCollection.deleteOne({ _id: noteId });
      return true;
    } catch (error) {
      logger.error("Error deleting note:", error);
      return false;
    }
  }
}
