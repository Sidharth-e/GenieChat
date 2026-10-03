"use client";

import { memo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { ToolNodeData, UINode, JsonSchema7 } from "@/lib/workflow/types";
import { Variable } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { MentionInput } from "../mention-input";
import { ToolPicker } from "./tool-picker";

export const ToolNodeConfig = memo(function ToolNodeConfig({
  data,
}: {
  data: ToolNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();

  return (
    <div className="flex flex-col gap-3 px-4">
      <div>
        <p className="text-sm font-medium mb-1.5">Tool</p>
        <ToolPicker
          value={data.tool}
          onChange={(tool) => updateNodeData(data.id, { tool })}
        />
      </div>

      {data.tool?.description && (
        <div className="text-xs bg-secondary rounded-lg p-2">
          <p>{data.tool.description}</p>
          {data.tool.parameterSchema?.properties && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(data.tool.parameterSchema.properties).map(([key, schema]) => (
                <div key={key} className="flex items-center text-xs px-1.5 py-0.5 bg-background rounded-md">
                  <Variable className="size-3 text-primary mr-0.5" />
                  <span className="font-medium">{key}</span>
                  <span className="text-muted-foreground ml-1">{(schema as JsonSchema7)?.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Separator />

      <div>
        <p className="text-sm font-medium mb-1.5">Message</p>
        <MentionInput
          currentNodeId={data.id}
          content={data.message}
          onChange={(content) => updateNodeData(data.id, { message: content })}
          editable={true}
          placeholder="Describe how to use the tool..."
        />
      </div>
    </div>
  );
});
ToolNodeConfig.displayName = "ToolNodeConfig";
