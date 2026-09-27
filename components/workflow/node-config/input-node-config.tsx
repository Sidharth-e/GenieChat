"use client";

import { memo, useCallback, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { InputNodeData, UINode, JsonSchema7 } from "@/lib/workflow/types";
import { Plus, Trash2, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export const InputNodeConfig = memo(function InputNodeConfig({
  data,
}: {
  data: InputNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();

  const addField = useCallback(
    (key: string, type: string) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as InputNodeData;
        return {
          outputSchema: {
            ...prev.outputSchema,
            properties: {
              ...prev.outputSchema.properties,
              [key]: { type, description: "" },
            },
            required: [...(prev.outputSchema.required || []), key],
          },
        };
      });
    },
    [data.id, updateNodeData],
  );

  const removeField = useCallback(
    (key: string) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as InputNodeData;
        const properties = { ...prev.outputSchema.properties };
        delete properties[key];
        return {
          outputSchema: {
            ...prev.outputSchema,
            properties,
            required: prev.outputSchema.required?.filter((k) => k !== key),
          },
        };
      });
    },
    [data.id, updateNodeData],
  );

  return (
    <div className="flex flex-col gap-3 px-4">
      <p className="text-sm font-medium">Input Fields</p>
      <div className="flex flex-col gap-1.5">
        {Object.entries(data.outputSchema.properties ?? {}).map(([key, value]) => (
          <div
            key={key}
            className="flex items-center gap-1 py-1.5 px-2 bg-secondary rounded-lg group"
          >
            <Variable className="size-3 text-primary shrink-0" />
            <span className="text-sm truncate flex-1">{key}</span>
            <span className="text-xs text-muted-foreground">
              {data.outputSchema.required?.includes(key) && (
                <span className="text-red-500 mr-0.5">*</span>
              )}
              {(value as JsonSchema7)?.type}
            </span>
            <button
              onClick={() => removeField(key)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500 transition-opacity"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <AddFieldInline onAdd={addField} />
    </div>
  );
});
InputNodeConfig.displayName = "InputNodeConfig";

function AddFieldInline({ onAdd }: { onAdd: (key: string, type: string) => void }) {
  const [isAdding, setIsAdding] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("string");

  if (!isAdding) {
    return (
      <Button
        variant="outline"
        className="w-full border-dashed text-muted-foreground"
        onClick={() => setIsAdding(true)}
      >
        <Plus className="size-4" /> Add Input Field
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={fieldName}
        onChange={(e) => setFieldName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
        placeholder="field_name"
        className="flex-1 h-8 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && fieldName.trim()) {
            onAdd(fieldName.trim(), fieldType);
            setFieldName("");
            setIsAdding(false);
          }
          if (e.key === "Escape") setIsAdding(false);
        }}
      />
      <Select
        value={fieldType}
        onChange={setFieldType}
        options={[
          { value: "string", label: "string" },
          { value: "number", label: "number" },
          { value: "boolean", label: "boolean" },
        ]}
        className="w-24"
      />
      <Button
        size="sm"
        className="h-8"
        disabled={!fieldName.trim()}
        onClick={() => {
          onAdd(fieldName.trim(), fieldType);
          setFieldName("");
          setIsAdding(false);
        }}
      >
        Add
      </Button>
    </div>
  );
}
