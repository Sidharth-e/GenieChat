"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  NotebookTabs,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useNotes,
  useNote,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from "@/hooks/use-notes-queries";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageEditor, EditablePage } from "@/components/workspace/notes/page-editor";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { WorkspaceNoteSummary } from "@/lib/notes/types";

interface NotesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalView = { type: "list" } | { type: "edit"; noteId: string } | { type: "new" };

export function NotesModal({ open, onOpenChange }: NotesModalProps) {
  const [view, setView] = React.useState<ModalView>({ type: "list" });
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    if (open) {
      setView({ type: "list" });
      setSearchInput("");
      setDebouncedSearch("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[980px] w-full h-[90vh] max-h-[90vh] p-0 flex flex-col border border-modal-border/40 bg-modal-bg rounded-lg">
        <AnimatePresence mode="wait" initial={false}>
          {view.type === "list" ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col h-full"
            >
              <NotesList
                searchInput={searchInput}
                debouncedSearch={debouncedSearch}
                onSearchChange={setSearchInput}
                onClose={() => onOpenChange(false)}
                onEditNote={(id) => setView({ type: "edit", noteId: id })}
                onNewNote={() => setView({ type: "new" })}
              />
            </motion.div>
          ) : (
            <motion.div
              key={view.type === "edit" ? `edit-${view.noteId}` : "new"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col h-full"
            >
              <NoteEditorView
                noteId={view.type === "edit" ? view.noteId : null}
                onBack={() => setView({ type: "list" })}
                onClose={() => onOpenChange(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

interface NotesListProps {
  searchInput: string;
  debouncedSearch: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onEditNote: (id: string) => void;
  onNewNote: () => void;
}

function NotesList({
  searchInput,
  debouncedSearch,
  onSearchChange,
  onClose,
  onEditNote,
  onNewNote,
}: NotesListProps) {
  const { data: notes = [], isLoading } = useNotes(debouncedSearch || undefined);
  const deleteNote = useDeleteNote();
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    setDeleteTarget(noteId);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteNote.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <>
      <DeleteConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={deleteNote.isPending}
        title="Delete Note"
        description="This note will be permanently deleted. This action cannot be undone."
        dialogClassName="z-[60]"
      />
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-secondary/50">
            <NotebookTabs className="h-4 w-4 text-foreground/80" />
          </div>
          <div className="space-y-1">
            <h2 className="font-serif text-2xl text-foreground">Notes</h2>
          </div>
        </div>
        <div className="flex w-full max-w-sm items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes..."
              className="h-10 w-full rounded-full border border-card-border bg-card-bg pl-9 pr-3 text-sm text-foreground placeholder:text-text-secondary focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={onNewNote}
            className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-background transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground"
            aria-label="Close notes"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 p-1 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border border-card-border bg-card-bg px-3.5 py-3"
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-md bg-tertiary/10" />
                  <div className="h-4 flex-1 rounded bg-tertiary/10" />
                </div>
                <div className="mt-2 h-3 w-full rounded bg-tertiary/8" />
                <div className="mt-1 h-3 w-2/3 rounded bg-tertiary/8" />
                <div className="mt-3 border-t border-card-border pt-2">
                  <div className="h-3 w-24 rounded bg-tertiary/8" />
                </div>
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <StickyNote className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm font-medium">
              {debouncedSearch ? "No notes found" : "No notes yet"}
            </p>
            <p className="mt-1 text-xs opacity-70">
              {debouncedSearch
                ? "Try a different search term"
                : "Create your first note to get started"}
            </p>
            {!debouncedSearch && (
              <button
                onClick={onNewNote}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Create Note
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-1 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((note, index) => (
              <NoteListItem
                key={note.id}
                note={note}
                index={index}
                onEdit={() => onEditNote(note.id)}
                onDelete={(e) => handleDeleteClick(e, note.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface NoteListItemProps {
  note: WorkspaceNoteSummary;
  index: number;
  onEdit: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function NoteListItem({ note, index, onEdit, onDelete }: NoteListItemProps) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onEdit(); }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className="group relative flex h-full cursor-pointer flex-col rounded-lg border border-card-border bg-card-bg px-3.5 py-3 transition-all duration-200 hover:-translate-y-px hover:border-primary/25 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <StickyNote className="h-3.5 w-3.5" />
        </div>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-foreground">
          {note.title || "Untitled"}
        </h3>
      </div>

      <p className="mt-1.5 min-h-10 line-clamp-2 text-xs leading-relaxed text-text-secondary">
        {note.preview || "No content"}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-card-border pt-2">
        <span className="flex items-center gap-1 truncate rounded bg-hover-bg px-1.5 py-px text-[10px] text-text-secondary">
          <Clock className="h-2.5 w-2.5" />
          {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
        </span>
        <div className="flex-1" />
        <button
          onClick={onDelete}
          className="shrink-0 rounded-md p-0.5 text-text-secondary/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
          title="Delete note"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

interface NoteEditorViewProps {
  noteId: string | null;
  onBack: () => void;
  onClose: () => void;
}

function NoteEditorView({ noteId, onBack, onClose }: NoteEditorViewProps) {
  const { data: note, isLoading } = useNote(noteId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNoteMutation = useDeleteNote();
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const createdRef = React.useRef(false);

  const effectiveNoteId = noteId || createdId;
  const { data: createdNoteData } = useNote(createdId);
  const effectiveNote = noteId ? note : createdNoteData;

  const editorPage = React.useMemo<EditablePage>(() => {
    if (effectiveNote) {
      return {
        id: effectiveNote.id,
        title: effectiveNote.title,
        content: effectiveNote.content,
      };
    }
    return { id: "new", title: "", content: "" };
  }, [effectiveNote]);

  const handleUpdate = React.useCallback(
    (updates: Partial<EditablePage>) => {
      if (effectiveNoteId) {
        updateNote.mutate({
          id: effectiveNoteId,
          updates: {
            title: updates.title,
            content: updates.content,
          },
        });
        return;
      }

      if (createdRef.current) return;
      createdRef.current = true;

      const title = (updates.title ?? "").trim() || "Untitled";
      const content = updates.content ?? "<p></p>";

      createNote.mutate(
        { title, content },
        {
          onSuccess: (created) => {
            setCreatedId(created.id);
          },
          onError: () => {
            createdRef.current = false;
          },
        },
      );
    },
    [effectiveNoteId, updateNote, createNote],
  );

  const [showDeleteModal, setShowDeleteModal] = React.useState(false);

  const handleConfirmDelete = () => {
    if (!effectiveNoteId) return;
    deleteNoteMutation.mutate(effectiveNoteId, {
      onSuccess: () => {
        setShowDeleteModal(false);
        onBack();
      },
    });
  };

  return (
    <>
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={deleteNoteMutation.isPending}
        title="Delete Note"
        description="This note will be permanently deleted. This action cannot be undone."
        dialogClassName="z-[60]"
      />
      <div className="flex items-center justify-between border-b border-tertiary/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-tertiary/10 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-foreground">
            {noteId ? "Edit Note" : "New Note"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {effectiveNoteId && (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
              title="Delete note"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-tertiary/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && noteId ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <PageEditor page={editorPage} onUpdate={handleUpdate} />
        )}
      </div>
    </>
  );
}
