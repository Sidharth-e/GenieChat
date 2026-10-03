"use client";

import { useReactFlow } from "@xyflow/react";
import { NodeKind, type UINode, type HttpNodeData } from "@/lib/workflow/types";
import { NodeIcon } from "./node-icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InputNodeConfig } from "./node-config/input-node-config";
import { OutputNodeConfig } from "./node-config/output-node-config";
import { LLMNodeConfig } from "./node-config/llm-node-config";
import { ConditionNodeConfig } from "./node-config/condition-node-config";
import { HttpNodeConfig } from "./node-config/http-node-config";
import { ToolNodeConfig } from "./node-config/tool-node-config";
import { TemplateNodeConfig } from "./node-config/template-node-config";
import { CodeNodeConfig } from "./node-config/code-node-config";

export function SelectedNodeConfig({ node }: { node: UINode }) {
  const { updateNodeData, setNodes, setEdges } = useReactFlow<UINode>();

  const isDeletable = node.data.kind !== NodeKind.Input && node.data.kind !== NodeKind.Output;

  const handleDelete = () => {
    if (!isDeletable) {
      toast.warning("This node cannot be deleted");
      return;
    }
    setNodes((nds) => nds.filter((n) => n.id !== node.id));
    setEdges((eds) => eds.filter((e) => e.source !== node.id && e.target !== node.id));
  };

  return (
    <div
      key={node.id}
      className="w-96 max-h-[85vh] bg-secondary border border-card-border rounded-xl shadow-xl overflow-y-auto py-4"
    >
      {/* Header */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2">
          <NodeIcon type={node.data.kind} />
          <Input
            maxLength={30}
            onChange={(e) => updateNodeData(node.id, { name: e.target.value })}
            value={node.data.name}
            className="bg-transparent border-none px-0 text-base font-semibold h-8"
          />
          <button
            className="p-1 rounded hover:bg-secondary ml-auto shrink-0"
            onClick={() =>
              setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, selected: false } : n)))
            }
          >
            <X className="size-3.5" />
          </button>
        </div>
        {node.data.kind !== NodeKind.Note && (
          <Textarea
            className="text-xs bg-transparent resize-none h-6 min-h-6 max-h-14 mt-1 p-0 border-none overflow-y-auto"
            value={node.data.description || ""}
            onChange={(e) => updateNodeData(node.id, { description: e.target.value })}
            placeholder="Add a description..."
          />
        )}
      </div>

      <Separator />

      {/* Config panel per node kind */}
      <div className="mt-3">
        {node.data.kind === NodeKind.Input && <InputNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Output && <OutputNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.LLM && <LLMNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Condition && <ConditionNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Http && <HttpNodeConfig data={node.data as HttpNodeData} />}
        {node.data.kind === NodeKind.Tool && <ToolNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Template && <TemplateNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Code && <CodeNodeConfig data={node.data} />}
        {node.data.kind === NodeKind.Note && (
          <div className="px-4">
            <Textarea
              className="resize-none min-h-[200px]"
              value={node.data.description || ""}
              onChange={(e) => updateNodeData(node.id, { description: e.target.value })}
              placeholder="Write your notes..."
            />
          </div>
        )}
      </div>

      {/* Delete button */}
      {isDeletable && (
        <>
          <Separator className="mt-3" />
          <div className="px-4 pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
            >
              <Trash2 className="size-3.5" />
              Delete Node
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
