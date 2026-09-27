"use client";

import * as React from "react";
import { Note, NoteColor } from "@/lib/types";
import { StickyNote } from "./sticky-note";
import { Plus, Search, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface NoteGridProps {
  notes: Note[];
  onCreateNote: () => void;
  onEditNote: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
  onTogglePin: (noteId: string) => void;
  onColorChange: (noteId: string, color: NoteColor) => void;
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
}

export function NoteGrid({
  notes,
  onCreateNote,
  onEditNote,
  onDeleteNote,
  onTogglePin,
  onColorChange,
  searchTerm = "",
  onSearchChange,
}: NoteGridProps) {
  const pinnedNotes = notes.filter((note) => note.isPinned);
  const unpinnedNotes = notes.filter((note) => !note.isPinned);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        {onSearchChange && (
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
            <Input
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes..."
              className="pl-10"
            />
          </div>
        )}
        <Button onClick={onCreateNote} className="gap-2">
          <Plus className="h-4 w-4" />
          New Note
        </Button>
      </div>

      {/* Pinned Notes */}
      {pinnedNotes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Pin className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-foreground">Pinned</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {pinnedNotes.map((note) => (
              <StickyNote
                key={note.id}
                note={note}
                onEdit={onEditNote}
                onDelete={onDeleteNote}
                onTogglePin={onTogglePin}
                onColorChange={onColorChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other Notes */}
      {unpinnedNotes.length > 0 && (
        <div>
          {pinnedNotes.length > 0 && (
            <h3 className="font-semibold text-foreground mb-4">Other Notes</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {unpinnedNotes.map((note) => (
              <StickyNote
                key={note.id}
                note={note}
                onEdit={onEditNote}
                onDelete={onDeleteNote}
                onTogglePin={onTogglePin}
                onColorChange={onColorChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {notes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <div className="w-16 h-16 rounded-2xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center mb-4">
            <span className="text-3xl">📝</span>
          </div>
          <h3 className="font-semibold text-foreground mb-2">No notes yet</h3>
          <p className="text-sm mb-4">Create your first note to get started</p>
          <Button onClick={onCreateNote} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Note
          </Button>
        </div>
      )}
    </div>
  );
}
