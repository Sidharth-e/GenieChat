"use client";

import { useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface MemoryFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
  isSaving: boolean;
}

/**
 * The capture form. There is one mode: a sentence goes in, a `:Capture` node is
 * staged, and the extractor turns it into facts later. Nothing here edits a
 * fact, because a fact is derived rather than authored.
 */
export function MemoryForm({
  isOpen,
  onClose,
  onSave,
  isSaving,
}: MemoryFormProps) {
  const [content, setContent] = useState("");

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!content.trim()) return;
    await onSave(content.trim());
    setContent("");
  };

  const handleClose = () => {
    setContent("");
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="mb-6 p-5 rounded-2xl bg-card-bg border border-card-border"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Add Memory</h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-8 w-8 rounded-lg text-text-secondary hover:bg-muted"
          title="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What should the AI remember about you? (e.g., 'I prefer concise answers' or 'I lead backend engineering at Acme')"
        className="w-full p-3 rounded-xl bg-input-bg border border-input-border resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
        rows={3}
        autoFocus
      />
      <div className="flex items-center justify-end mt-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={handleClose}
            className="px-4 py-1.5 rounded-xl text-sm text-text-secondary hover:bg-muted transition-colors"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!content.trim() || isSaving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Save
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
