"use client";

import { memo, useCallback, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { OutputNodeData, UINode } from "@/lib/workflow/types";
import { Plus, Trash2, Variable, ChevronDown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VariableSelect } from "../variable-select";
import { findJsonSchemaByPath } from "@/lib/workflow/shared";

export const OutputNodeConfig = memo(function OutputNodeConfig({
  data,
}: {
  data: OutputNodeData;
}) {
  const { getNodes, updateNodeData } = useReactFlow<UINode>();

  const outputVariables = useMemo(() => {
    const nodes = getNodes();
    return data.outputData.map(({ key, source }) => {
      const targetNode = nodes.find((n) => n.data.id === source?.nodeId);
      const schema = targetNode
        ? findJsonSchemaByPath(targetNode.data.outputSchema, source?.path ?? [])
        : undefined;
      return {
        key,
        schema,
        path: source?.path ?? [],
        nodeName: targetNode?.data.name,
        isNotFound: (source && !targetNode) || (targetNode && !schema),
      };
    });
  }, [data.outputData, getNodes]);

  const updateOutputVariable = useCallback(
    (index: number, item: { key?: string; source?: { nodeId: string; path: string[] } }) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as OutputNodeData;
        return {
          outputData: prev.outputData.map((v, i) => (i === index ? { ...v, ...item } : v)),
        };
      });
    },
    [data.id, updateNodeData],
  );

  const deleteOutputVariable = useCallback(
    (index: number) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as OutputNodeData;
        return { outputData: prev.outputData.filter((_, i) => i !== index) };
      });
    },
    [data.id, updateNodeData],
  );

  const addOutputVariable = useCallback(() => {
    updateNodeData(data.id, (node) => {
      const prev = node.data as OutputNodeData;
      return {
        outputData: [...prev.outputData, { key: "output", source: undefined }],
      };
    });
  }, [data.id, updateNodeData]);

  return (
    <div className="flex flex-col gap-3 px-4">
      <p className="text-sm font-medium">Output Variables</p>
      <div className="flex flex-col gap-2">
        {outputVariables.map((item, index) => (
          <div className="flex items-center gap-1" key={index}>
            <Input
              value={item.key}
              onChange={(e) =>
                updateOutputVariable(index, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })
              }
              className="w-24 h-8 text-sm"
              placeholder="name"
            />
            <VariableSelect
              currentNodeId={data.id}
              onChange={(selected) =>
                updateOutputVariable(index, {
                  source: { nodeId: selected.nodeId, path: selected.path },
                })
              }
            >
              <button className="flex-1 min-w-0 flex items-center gap-1 px-2 py-1.5 border rounded-lg text-xs cursor-pointer hover:bg-secondary">
                {item.isNotFound ? (
                  <TriangleAlert className="size-3 text-red-500 shrink-0" />
                ) : (
                  <Variable className="size-3 text-primary shrink-0" />
                )}
                <span className="truncate">{item.nodeName || "Select"}/{item.path.join(".")}</span>
                <span className="text-muted-foreground ml-auto">{item.schema?.type}</span>
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </VariableSelect>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteOutputVariable(index)}>
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
        <Button variant="outline" onClick={addOutputVariable} className="w-full border-dashed text-muted-foreground">
          <Plus className="size-4" /> Add Output Variable
        </Button>
      </div>
    </div>
  );
});
OutputNodeConfig.displayName = "OutputNodeConfig";
