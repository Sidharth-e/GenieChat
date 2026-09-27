"use client";

import { memo, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { LLMNodeData, UINode, JsonSchema7 } from "@/lib/workflow/types";
import { Trash2, MessageCirclePlus, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { MentionInput } from "../mention-input";
import { Separator } from "@/components/ui/separator";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

export const LLMNodeConfig = memo(function LLMNodeConfig({
  data,
}: {
  data: LLMNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();

  const updateMessage = useCallback(
    (index: number, message: Partial<LLMNodeData["messages"][number]>) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as LLMNodeData;
        return {
          messages: prev.messages.map((m, i) => (i !== index ? m : { ...m, ...message })),
        };
      });
    },
    [data.id, updateNodeData],
  );

  const removeMessage = useCallback(
    (index: number) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as LLMNodeData;
        return { messages: prev.messages.filter((_, i) => i !== index) };
      });
    },
    [data.id, updateNodeData],
  );

  const addMessage = useCallback(() => {
    updateNodeData(data.id, (node) => {
      const prev = node.data as LLMNodeData;
      return { messages: [...prev.messages, { role: "user" as const }] };
    });
  }, [data.id, updateNodeData]);

  const modelOptions = AVAILABLE_MODELS.map((m) => ({
    value: m.id,
    label: m.name,
    description: m.description,
  }));

  const selectedModelId =
    AVAILABLE_MODELS.find(
      (m) => m.provider === data.model?.provider && m.model === data.model?.model,
    )?.id ?? "";

  const handleModelChange = useCallback(
    (modelId: string) => {
      const config = AVAILABLE_MODELS.find((m) => m.id === modelId);
      if (!config) return;
      updateNodeData(data.id, {
        model: { provider: config.provider, model: config.model },
      });
    },
    [data.id, updateNodeData],
  );

  return (
    <div className="flex flex-col gap-3 px-4">
      <div>
        <p className="text-sm font-medium mb-1.5">Model</p>
        <Select
          value={selectedModelId}
          onChange={handleModelChange}
          options={modelOptions}
          placeholder="Select a model"
        />
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Output Schema</p>
        <div className="flex items-center flex-wrap gap-1">
          {Object.entries(data.outputSchema?.properties || {}).map(([key, value]) => (
            <div key={key} className="flex items-center text-xs px-1.5 py-0.5 bg-secondary rounded-md">
              <Variable className="size-3 text-primary mr-0.5" />
              <span className="font-medium">{key}</span>
              <span className="text-muted-foreground ml-1">{(value as JsonSchema7)?.type}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <p className="text-sm font-medium mb-2">Messages</p>
        <div className="flex flex-col gap-2">
          {data.messages.map((message, index) => (
            <div key={index} className="bg-secondary rounded-lg p-2">
              <div className="flex items-center gap-2 mb-2">
                <Select
                  value={message.role}
                  onChange={(value: string) =>
                    updateMessage(index, { role: value as "user" | "assistant" | "system" })
                  }
                  options={[
                    { value: "user", label: "USER" },
                    { value: "assistant", label: "ASSISTANT" },
                    { value: "system", label: "SYSTEM" },
                  ]}
                  className="w-28"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6 hover:bg-red-500/10 hover:text-red-500"
                  onClick={() => removeMessage(index)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <MentionInput
                currentNodeId={data.id}
                content={message.content}
                onChange={(content) => updateMessage(index, { content })}
                editable={true}
              />
            </div>
          ))}
          <Button
            variant="outline"
            className="w-full border-dashed text-muted-foreground"
            onClick={addMessage}
          >
            <MessageCirclePlus className="size-4" /> Add Message
          </Button>
        </div>
      </div>
    </div>
  );
});
LLMNodeConfig.displayName = "LLMNodeConfig";
