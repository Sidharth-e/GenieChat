"use client";

import * as React from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Prompt } from "@/lib/types";
import { generatePromptTemplateAction } from "@/lib/ai-actions/prompt-actions";
import { logger } from "@/lib/logger";

export interface PromptEditorData {
  title: string;
  content: string;
  tags: string[];
}

interface PromptEditorProps {
  /** The prompt being edited, or null to create a new one. */
  initialData: Prompt | null;
  onSave: (data: PromptEditorData) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
  error?: string | null;
}

const FIELD_CLASS =
  "bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary rounded-lg";

/**
 * The create/edit form shown in the prompt library modal's right pane.
 * Renders as a plain panel rather than a dialog — the modal is the overlay.
 */
export function PromptEditor({
  initialData,
  onSave,
  onCancel,
  isSaving,
  error,
}: PromptEditorProps) {
  const [title, setTitle] = React.useState(initialData?.title ?? "");
  const [content, setContent] = React.useState(initialData?.content ?? "");
  const [tags, setTags] = React.useState((initialData?.tags ?? []).join(", "));

  const [assistQuery, setAssistQuery] = React.useState("");
  const [isGenerating, setIsGenerating] = React.useState(false);

  const variables = React.useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(content.matchAll(/\{\{([^}]+)\}\}/g)).map((m) => m[1]),
        ),
      ),
    [content],
  );

  const handleGenerate = async () => {
    const query = assistQuery.trim();
    if (!query || isGenerating) return;

    setIsGenerating(true);
    try {
      const result = await generatePromptTemplateAction(query);
      if (result.title) setTitle(result.title);
      if (result.template) setContent(result.template);
      if (result.tags.length > 0) {
        setTags((prev) => {
          const existing = prev
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          return Array.from(new Set([...existing, ...result.tags])).join(", ");
        });
      }
      setAssistQuery("");
    } catch (generateError) {
      logger.error({ error: generateError }, "Prompt generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = () => {
    if (!title.trim() || !content.trim() || isSaving) return;

    onSave({
      title: title.trim(),
      content,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 pb-6">
      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        {initialData ? "Edit Prompt" : "New Prompt"}
      </p>

      <div className="shrink-0 rounded-xl border border-card-border bg-card-bg/75 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            AI Assist
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={assistQuery}
            onChange={(e) => setAssistQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGenerate();
              }
            }}
            disabled={isGenerating}
            placeholder="Describe the prompt you want..."
            className={`h-9 text-sm ${FIELD_CLASS}`}
          />
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!assistQuery.trim() || isGenerating}
            className="h-9 shrink-0 rounded-full px-3 shadow-none hover:scale-100"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Generate"
            )}
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-1.5">
        <label className="text-sm font-medium text-tertiary">Title</label>
        <Input
          placeholder="Name your prompt"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`h-10 ${FIELD_CLASS}`}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <label className="text-sm font-medium text-tertiary">Content</label>
        <Textarea
          placeholder="Enter your prompt template... Use {{variable}} for dynamic content"
          className={`min-h-[180px] flex-1 resize-y font-mono text-sm leading-relaxed ${FIELD_CLASS}`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        {variables.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {variables.map((variable) => (
              <span
                key={variable}
                className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              >
                {variable}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-1.5">
        <label className="text-sm font-medium text-tertiary">
          Tags{" "}
          <span className="font-normal text-tertiary/40">(comma-separated)</span>
        </label>
        <Input
          placeholder="coding, review, productivity"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className={`h-10 ${FIELD_CLASS}`}
        />
      </div>

      {error && <p className="shrink-0 text-xs text-red-500">{error}</p>}

      <div className="mt-auto flex shrink-0 items-center justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
          className="h-9 rounded-md px-4 shadow-none hover:scale-100"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!title.trim() || !content.trim() || isSaving}
          className="h-9 rounded-md px-4 shadow-none hover:scale-100"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : initialData ? (
            "Save Changes"
          ) : (
            "Create Prompt"
          )}
        </Button>
      </div>
    </div>
  );
}
