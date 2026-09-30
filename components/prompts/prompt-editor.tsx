"use client";

import * as React from "react";
import { ArrowLeft, Loader2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Prompt } from "@/lib/types";
import { generatePromptTemplateAction } from "@/lib/ai-actions/prompt-actions";
import { PromptDialog } from "@/components/agents/form-sections/prompt-dialog";
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
  /** Leave the editor and return to the library list. */
  onCancel: () => void;
  /** Dismiss the whole prompt library. */
  onClose: () => void;
  isSaving: boolean;
  error?: string | null;
}

const FIELD_CLASS =
  "bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary rounded-lg";

const ICON_BUTTON_CLASS =
  "rounded-md p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground";

/**
 * The create/edit view. Takes over the whole prompt library modal — the header
 * carries back (to the list) and close (the library), and the form fills the body.
 */
export function PromptEditor({
  initialData,
  onSave,
  onCancel,
  onClose,
  isSaving,
  error,
}: PromptEditorProps) {
  const [title, setTitle] = React.useState(initialData?.title ?? "");
  const [content, setContent] = React.useState(initialData?.content ?? "");
  const [tags, setTags] = React.useState((initialData?.tags ?? []).join(", "));

  const [isGeneratorOpen, setIsGeneratorOpen] = React.useState(false);
  const [generatorQuery, setGeneratorQuery] = React.useState("");
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
    if (!generatorQuery.trim()) return;

    setIsGenerating(true);
    try {
      const result = await generatePromptTemplateAction(generatorQuery);
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
      setIsGeneratorOpen(false);
      setGeneratorQuery("");
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-tertiary/10 px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className={ICON_BUTTON_CLASS}
          aria-label="Back to prompt library"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="font-serif text-xl text-foreground">
          {initialData ? "Edit Prompt" : "New Prompt"}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsGeneratorOpen(true)}
            disabled={isGenerating}
            className="h-9 rounded-full border-primary/20 px-4 font-semibold text-primary hover:bg-primary/10"
          >
            <Wand2 className="mr-2 h-4 w-4" />
            AI Assist
          </Button>
          <button
            type="button"
            onClick={onClose}
            className={ICON_BUTTON_CLASS}
            aria-label="Close prompt library"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-tertiary">Title</label>
            <Input
              placeholder="Name your prompt"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`h-10 ${FIELD_CLASS}`}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-tertiary">
              Content
            </label>
            <Textarea
              placeholder="Enter your prompt template... Use {{variable}} for dynamic content"
              className={`min-h-[240px] resize-y font-mono text-sm leading-relaxed ${FIELD_CLASS}`}
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-tertiary">
              Tags{" "}
              <span className="font-normal text-tertiary/40">
                (comma-separated)
              </span>
            </label>
            <Input
              placeholder="coding, review, productivity"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className={`h-10 ${FIELD_CLASS}`}
            />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-tertiary/10 px-5 py-3">
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="ml-auto flex items-center gap-2">
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

      <PromptDialog
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        query={generatorQuery}
        setQuery={setGeneratorQuery}
        isGenerating={isGenerating}
        onGenerate={handleGenerate}
        title="Generate a Prompt"
        description="Describe what you want the prompt to do — the title, template and tags are filled in for you."
        placeholder="e.g. 'A prompt that reviews a pull request', 'Summarise a meeting transcript into action items', or 'Explain a codebase to a new engineer'"
      />
    </div>
  );
}
