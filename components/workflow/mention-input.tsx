"use client";

import { useCallback } from "react";
import { Variable } from "lucide-react";
import type {
  TipTapMentionJsonContent,
  OutputSchemaSourceKey,
} from "@/lib/workflow/types";
import { VariableSelect } from "./variable-select";
import { VariableMentionItem } from "./variable-mention-item";
import { findAvailableSchemaBySource } from "@/lib/workflow/shared";
import { useReactFlow } from "@xyflow/react";
import type { UINode } from "@/lib/workflow/types";
import { cn } from "@/lib/utils";

interface MentionInputProps {
  currentNodeId: string;
  content?: TipTapMentionJsonContent;
  onChange: (content: TipTapMentionJsonContent) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Simplified mention input using textarea + variable insert button.
 * Extracts plain text from TipTap JSON for editing, and mentions are
 * shown as chips below the textarea.
 */
export function MentionInput({
  currentNodeId,
  content,
  onChange,
  editable = true,
  placeholder = "Type here... Use the variable button to insert references.",
  className,
}: MentionInputProps) {
  const { getNodes, getEdges } = useReactFlow<UINode>();

  // Extract plain text from TipTap content
  const plainText = extractPlainText(content);

  // Extract mentions from TipTap content
  const mentions = extractMentions(content);

  const handleTextChange = useCallback(
    (text: string) => {
      // Rebuild TipTap JSON with just a paragraph of text, preserving existing mentions
      const newContent: TipTapMentionJsonContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text },
              ...mentions.map((m) => ({
                type: "mention" as const,
                attrs: { id: m.id, label: m.label },
              })),
            ],
          },
        ],
      };
      onChange(newContent);
    },
    [mentions, onChange],
  );

  const handleInsertVariable = useCallback(
    (item: {
      nodeId: string;
      path: string[];
      nodeName: string;
      type: string;
    }) => {
      const mentionId = [item.nodeId, ...item.path].join(".");
      const mentionLabel = `${item.nodeName}.${item.path.join(".")}`;

      const newContent: TipTapMentionJsonContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              ...(content?.content?.[0]?.content || []),
              {
                type: "mention",
                attrs: { id: mentionId, label: mentionLabel },
              },
            ],
          },
        ],
      };
      onChange(newContent);
    },
    [content, onChange],
  );

  const handleRemoveMention = useCallback(
    (mentionId: string) => {
      if (!content) return;
      const newContent: TipTapMentionJsonContent = {
        type: "doc",
        content: content.content.map((block) => ({
          ...block,
          content: block.content?.filter(
            (item) =>
              !(item.type === "mention" && item.attrs?.id === mentionId),
          ),
        })),
      };
      onChange(newContent);
    },
    [content, onChange],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-1">
        <textarea
          className="flex-1 min-h-[60px] text-sm bg-transparent border border-tertiary/10 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          value={plainText}
          onChange={(e) => handleTextChange(e.target.value)}
          disabled={!editable}
          placeholder={placeholder}
        />
        {editable && (
          <VariableSelect
            currentNodeId={currentNodeId}
            onChange={handleInsertVariable}
          >
            <button
              className="p-2 rounded-lg border border-tertiary/10 hover:bg-secondary transition-colors"
              title="Insert variable"
            >
              <Variable className="size-4 text-primary" />
            </button>
          </VariableSelect>
        )}
      </div>

      {/* Show inserted mentions as chips */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentions.map((mention) => {
            const sourceKey = tryParseSourceKey(mention.id);
            if (!sourceKey) return null;

            const info = findAvailableSchemaBySource({
              nodeId: currentNodeId,
              source: sourceKey,
              nodes: getNodes().map((n) => n.data),
              edges: getEdges(),
            });

            return (
              <VariableMentionItem
                key={mention.id}
                nodeName={info.nodeName}
                path={info.path}
                type={info.type}
                notFound={info.notFound}
                onRemove={
                  editable ? () => handleRemoveMention(mention.id) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function extractPlainText(content?: TipTapMentionJsonContent): string {
  if (!content?.content) return "";
  return content.content
    .flatMap((block) =>
      (block.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text || ""),
    )
    .join("\n");
}

function extractMentions(
  content?: TipTapMentionJsonContent,
): Array<{ id: string; label: string }> {
  if (!content?.content) return [];
  return content.content.flatMap((block) =>
    (block.content || [])
      .filter((item) => item.type === "mention" && item.attrs)
      .map((item) => ({
        id: item.attrs!.id,
        label: item.attrs!.label,
      })),
  );
}

function tryParseSourceKey(
  mentionId: string,
): OutputSchemaSourceKey | null {
  const [nodeId, ...path] = mentionId.split(".");
  if (!nodeId || path.length === 0) return null;
  return { nodeId, path };
}
