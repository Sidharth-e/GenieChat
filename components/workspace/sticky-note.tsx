"use client";

import * as React from "react";
import { Note, NoteColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Pin, MoreHorizontal, Trash2, Edit, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StickyNoteProps {
    note: Note;
    onEdit: (note: Note) => void;
    onDelete: (noteId: string) => void;
    onTogglePin: (noteId: string) => void;
    onColorChange: (noteId: string, color: NoteColor) => void;
}

const colorClasses: Record<NoteColor, { bg: string; border: string; text: string }> = {
    yellow: { bg: "bg-yellow-100 dark:bg-yellow-900/40", border: "border-yellow-300 dark:border-yellow-700", text: "text-yellow-900 dark:text-yellow-100" },
    pink: { bg: "bg-pink-100 dark:bg-pink-900/40", border: "border-pink-300 dark:border-pink-700", text: "text-pink-900 dark:text-pink-100" },
    blue: { bg: "bg-blue-100 dark:bg-blue-900/40", border: "border-blue-300 dark:border-blue-700", text: "text-blue-900 dark:text-blue-100" },
    green: { bg: "bg-green-100 dark:bg-green-900/40", border: "border-green-300 dark:border-green-700", text: "text-green-900 dark:text-green-100" },
    purple: { bg: "bg-purple-100 dark:bg-purple-900/40", border: "border-purple-300 dark:border-purple-700", text: "text-purple-900 dark:text-purple-100" },
    orange: { bg: "bg-orange-100 dark:bg-orange-900/40", border: "border-orange-300 dark:border-orange-700", text: "text-orange-900 dark:text-orange-100" },
    teal: { bg: "bg-teal-100 dark:bg-teal-900/40", border: "border-teal-300 dark:border-teal-700", text: "text-teal-900 dark:text-teal-100" },
    gray: { bg: "bg-gray-100 dark:bg-gray-800", border: "border-gray-300 dark:border-gray-600", text: "text-gray-900 dark:text-gray-100" },
};

const colorOptions: NoteColor[] = ["yellow", "pink", "blue", "green", "purple", "orange", "teal", "gray"];

export function StickyNote({
    note,
    onEdit,
    onDelete,
    onTogglePin,
    onColorChange,
}: StickyNoteProps) {
    const [showMenu, setShowMenu] = React.useState(false);
    const [showColorPicker, setShowColorPicker] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
                setShowColorPicker(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const colors = colorClasses[note.color];
    const previewContent = React.useMemo(
        () =>
            note.content
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
        [note.content],
    );

    return (
        <div
            className={cn(
                "group relative rounded-xl border-2 p-4 shadow-md transition-all duration-200",
                "hover:shadow-lg hover:-translate-y-1",
                colors.bg,
                colors.border,
                note.isPinned && "ring-2 ring-primary/50"
            )}
            style={{ minHeight: "180px" }}
        >
            {/* Pin Indicator */}
            {note.isPinned && (
                <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow-lg">
                    <Pin className="h-3 w-3" />
                </div>
            )}

            {/* Header */}
            <div className="flex items-start justify-between mb-2">
                <h4 className={cn("font-semibold text-base line-clamp-1", colors.text)}>
                    {note.title || "Untitled"}
                </h4>

                {/* Menu */}
                <div className="relative" ref={menuRef}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 h-6 w-6"
                        onClick={() => {
                            setShowMenu(!showMenu);
                            setShowColorPicker(false);
                        }}
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg bg-dropdown-bg border border-card-border shadow-lg z-50 animate-scale-in">
                            <button
                                onClick={() => {
                                    onEdit(note);
                                    setShowMenu(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover-bg rounded-t-lg"
                            >
                                <Edit className="h-4 w-4" />
                                Edit
                            </button>
                            <button
                                onClick={() => {
                                    onTogglePin(note.id);
                                    setShowMenu(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover-bg"
                            >
                                <Pin className="h-4 w-4" />
                                {note.isPinned ? "Unpin" : "Pin"}
                            </button>
                            <button
                                onClick={() => setShowColorPicker(!showColorPicker)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover-bg"
                            >
                                <Palette className="h-4 w-4" />
                                Color
                            </button>
                            <button
                                onClick={() => {
                                    onDelete(note.id);
                                    setShowMenu(false);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded-b-lg"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete
                            </button>
                        </div>
                    )}

                    {showColorPicker && (
                        <div className="absolute right-0 top-full mt-1 p-2 rounded-lg bg-dropdown-bg border border-card-border shadow-lg z-50 animate-scale-in">
                            <div className="grid grid-cols-4 gap-1">
                                {colorOptions.map((color) => (
                                    <button
                                        key={color}
                                        onClick={() => {
                                            onColorChange(note.id, color);
                                            setShowColorPicker(false);
                                            setShowMenu(false);
                                        }}
                                        className={cn(
                                            "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110",
                                            colorClasses[color].bg,
                                            colorClasses[color].border,
                                            note.color === color && "ring-2 ring-primary ring-offset-2"
                                        )}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Content */}
            <div
                className={cn(
                    "text-sm line-clamp-6 note-content",
                    colors.text,
                    "opacity-80"
                )}
            >
                {previewContent}
            </div>

            {/* Footer */}
            <div className="absolute bottom-3 left-4 right-4">
                <p className={cn("text-xs opacity-50", colors.text)}>
                    {new Date(note.updatedAt).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
}
