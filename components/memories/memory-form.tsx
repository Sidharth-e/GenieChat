"use client";

import { useState } from "react";
import { X, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { MemoryCategory } from "@/lib/types";
import { motion } from "framer-motion";

interface MemoryFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string, category: MemoryCategory) => Promise<void>;
  isSaving: boolean;
  mode?: "create" | "edit";
  initialContent?: string;
  initialCategory?: MemoryCategory;
}

export function MemoryForm({
  isOpen,
  onClose,
  onSave,
  isSaving,
  mode = "create",
  initialContent = "",
  initialCategory = "fact",
}: MemoryFormProps) {
  if (!isOpen) return null;

  return (
    <MemoryFormBody
      key={`${mode}:${initialCategory}:${initialContent}`}
      onClose={onClose}
      onSave={onSave}
      isSaving={isSaving}
      mode={mode}
      initialContent={initialContent}
      initialCategory={initialCategory}
    />
  );
}

function MemoryFormBody({
  onClose,
  onSave,
  isSaving,
  mode,
  initialContent,
  initialCategory,
}: Omit<MemoryFormProps, "isOpen">) {
  const [content, setContent] = useState(initialContent ?? "");
  const [category, setCategory] = useState<MemoryCategory>(
    initialCategory ?? "fact",
  );

  const handleSave = async () => {
    if (!content.trim()) return;
    await onSave(content.trim(), category);

    // Keep create mode ready for another entry; edit mode closes from parent.
    if (mode === "create") {
      setContent("");
      setCategory("fact");
    }
  };

  const handleClose = () => {
    setContent("");
    setCategory("fact");
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
        <h3 className="text-sm font-semibold text-foreground">
          {mode === "edit" ? "Edit Memory" : "Add Memory"}
        </h3>
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
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Category:</span>
          <Select
            value={category}
            onChange={(v) => setCategory(v as MemoryCategory)}
            options={[
              { value: "preference", label: "Preference" },
              { value: "fact", label: "Fact" },
              { value: "instruction", label: "Instruction" },
              { value: "professional", label: "Professional" },
              { value: "other", label: "Other" },
            ]}
            size="sm"
          />
        </div>
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
            {mode === "edit" ? "Update" : "Save"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
