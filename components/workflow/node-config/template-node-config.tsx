"use client";

import { memo, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { TemplateNodeData, UINode, TipTapMentionJsonContent } from "@/lib/workflow/types";
import { MentionInput } from "../mention-input";

export const TemplateNodeConfig = memo(function TemplateNodeConfig({
  data,
}: {
  data: TemplateNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();

  const handleTemplateChange = useCallback(
    (template: TipTapMentionJsonContent) => {
      updateNodeData(data.id, {
        template: { type: "tiptap", tiptap: template },
      });
    },
    [data.id, updateNodeData],
  );

  return (
    <div className="flex flex-col gap-3 px-4">
      <p className="text-sm font-medium">Template</p>
      <p className="text-xs text-muted-foreground">
        Write a template and insert variables from upstream nodes.
      </p>
      <MentionInput
        currentNodeId={data.id}
        content={data.template.tiptap}
        onChange={handleTemplateChange}
        editable={true}
        placeholder="Write your template here..."
        className="min-h-[120px]"
      />
    </div>
  );
});
TemplateNodeConfig.displayName = "TemplateNodeConfig";
