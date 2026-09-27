import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Prompt } from "@/lib/types";
import { FormDialog } from "@/components/common/form-dialog";

interface PromptDialogSaveData {
  title: string;
  content: string;
  tags: string[];
}

interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PromptDialogSaveData) => Promise<void>;
  initialData: Prompt | null;
  isSubmitting: boolean;
}

function PromptDialogBody({
  onClose,
  onSave,
  initialData,
  isSubmitting,
}: Omit<PromptDialogProps, "isOpen">) {
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [content, setContent] = useState(initialData?.content ?? "");
  const [tags, setTags] = useState(initialData?.tags.join(", ") ?? "");

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    await onSave({
      title: title.trim(),
      content,
      tags: tagList,
    });
  };

  return (
    <FormDialog
      isOpen={true}
      onClose={onClose}
      title={initialData ? "Edit Prompt" : "Create a prompt"}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      submitDisabled={!title.trim() || !content.trim()}
      submitLabel={initialData ? "Save Changes" : "Create Prompt"}
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-tertiary">Title</label>
        <Input
          placeholder="Name your prompt"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-tertiary">Content</label>
        <Textarea
          placeholder="Enter your prompt template... Use {{variable}} for dynamic content"
          className="min-h-[200px] font-mono text-sm leading-relaxed bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary rounded-lg resize-y"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        {content.match(/\{\{(\w+)\}\}/g) && (
          <div className="flex gap-2 flex-wrap pt-1">
            {content
              .match(/\{\{(\w+)\}\}/g)
              ?.map((v) => v.replace(/[{}]/g, ""))
              .map((variable, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary"
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
          <span className="text-tertiary/40 font-normal">
            (comma-separated)
          </span>
        </label>
        <Input
          placeholder="coding, review, productivity"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="bg-input-bg border-input-border text-tertiary placeholder:text-tertiary/40 focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary h-10 rounded-lg"
        />
      </div>
    </FormDialog>
  );
}

export function PromptDialog({
  isOpen,
  onClose,
  onSave,
  initialData,
  isSubmitting,
}: PromptDialogProps) {
  if (!isOpen) return null;

  return (
    <PromptDialogBody
      key={initialData ? `${initialData.id}:${initialData.updatedAt}` : "new"}
      onClose={onClose}
      onSave={onSave}
      initialData={initialData}
      isSubmitting={isSubmitting}
    />
  );
}
