"use client";

import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { NodeKind, type UINode } from "@/lib/workflow/types";
import { allConditionBranches } from "@/lib/workflow/resolve";
import { selectWorkflowEditable, useWorkflowEditorStore } from "@/lib/stores/workflow-editor";
import { cn } from "@/lib/utils";
import { Loader2, TriangleAlert, X } from "lucide-react";
import { memo } from "react";
import { NodeIcon } from "./node-icon";

type Props = NodeProps<UINode>;

export const DefaultNode = memo(function DefaultNode({
  id,
  data,
  isConnectable,
  selected,
}: Props) {
  const { setNodes, setEdges } = useReactFlow<UINode>();
  const editable = useWorkflowEditorStore(selectWorkflowEditable);

  // Input and Output are structural, so they stay; a read-only canvas offers no
  // delete affordance at all, since `setNodes` would be dropped by onNodesChange.
  const isDeletable =
    editable &&
    data.kind !== NodeKind.Input &&
    data.kind !== NodeKind.Output;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) =>
      eds.filter((e) => e.source !== id && e.target !== id),
    );
  };

  return (
    <div
      className={cn(
        "wf-node group relative w-72",
        data.kind === NodeKind.Note && "wf-node-note w-80 min-h-40",
        data.kind === NodeKind.Condition && "w-52",
        selected && "wf-node-selected",
        data.runtime?.status === "fail" && "wf-node-fail",
        data.runtime?.status === "success" && "wf-node-success",
        data.runtime?.status === "running" && "wf-node-running animate-pulse",
      )}
    >
      {/* Left handle (target) — not on Input or Note */}
      {![NodeKind.Note, NodeKind.Input].includes(data.kind) && (
        <Handle
          id="left"
          type="target"
          position={Position.Left}
          isConnectable={isConnectable}
          className="!w-3 !h-3 !border-2 !border-background !bg-primary"
        />
      )}

      {/* Right handles (source) */}
      {data.kind === NodeKind.Condition ? (
        // One handle per branch, with the handle id set to the branch's own id.
        // That id is what lands in the edge's `sourceHandle`, which is what
        // `conditionEdgeTargets` reads back when the graph is built.
        <div className="absolute -right-1 top-1/2 flex -translate-y-1/2 flex-col gap-3">
          {allConditionBranches(data.branches).map((branch) => (
            <div key={branch.id} className="relative flex items-center justify-end">
              <span className="mr-2 whitespace-nowrap text-[10px] font-medium uppercase wf-text-faint">
                {branch.type === "elseIf" ? "else if" : branch.type}
              </span>
              <Handle
                id={branch.id}
                type="source"
                position={Position.Right}
                isConnectable={isConnectable}
                className="!static !h-3 !w-3 !transform-none !border-2 !border-background !bg-primary"
              />
            </div>
          ))}
        </div>
      ) : (
        ![NodeKind.Note, NodeKind.Output].includes(data.kind) && (
          <Handle
            id="right"
            type="source"
            position={Position.Right}
            isConnectable={isConnectable}
            className="!w-3 !h-3 !border-2 !border-background !bg-primary"
          />
        )
      )}

      {/* Header */}
      <div className="wf-node-header">
        <NodeIcon type={data.kind} />
        <div className="font-bold text-[13px] truncate flex-1 wf-text">{data.name}</div>

        {/* Status indicators */}
        {data.runtime?.status === "fail" && (
          <TriangleAlert className="size-3.5 text-red-500 shrink-0" />
        )}
        {data.runtime?.status === "running" && (
          <Loader2 className="size-3.5 animate-spin shrink-0" />
        )}

        {/* Delete button — shows on hover, only on an editable canvas and not
            for the structural Input/Output nodes */}
        {isDeletable && (
          <button
            onClick={handleDelete}
            className="p-1 rounded-lg wf-text-faint hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete Node"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Description */}
      {data.description && data.kind !== NodeKind.Note && (
        <div className="px-3.5 py-2.5">
          <p className="text-xs wf-text-muted break-all whitespace-pre-wrap line-clamp-2">
            {data.description}
          </p>
        </div>
      )}

      {/* Empty body padding when no description */}
      {!data.description && data.kind !== NodeKind.Note && (
        <div className="py-1" />
      )}
    </div>
  );
});
DefaultNode.displayName = "DefaultNode";
