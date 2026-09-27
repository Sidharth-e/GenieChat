"use client";

import { memo, useCallback, useMemo } from "react";
import { useReactFlow, useNodes } from "@xyflow/react";
import type { ConditionNodeData, UINode } from "@/lib/workflow/types";
import type { ConditionBranch, ConditionRule } from "@/lib/workflow/condition";
import { getFirstConditionOperator, StringConditionOperator, NumberConditionOperator, BooleanConditionOperator } from "@/lib/workflow/condition";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select } from "@/components/ui/select";
import { VariableSelect } from "../variable-select";
import { VariableMentionItem } from "../variable-mention-item";
import { findJsonSchemaByPath } from "@/lib/workflow/shared";

export const ConditionNodeConfig = memo(function ConditionNodeConfig({
  data,
}: {
  data: ConditionNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();

  const updateIfBranch = useCallback(
    (branch: ConditionBranch) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as ConditionNodeData;
        return { branches: { ...prev.branches, if: branch } };
      });
    },
    [data.id, updateNodeData],
  );

  const addElseIfBranch = useCallback(() => {
    updateNodeData(data.id, (node) => {
      const prev = node.data as ConditionNodeData;
      return {
        branches: {
          ...prev.branches,
          elseIf: [
            ...(prev.branches.elseIf ?? []),
            { id: crypto.randomUUID(), type: "elseIf" as const, conditions: [], logicalOperator: "AND" as const },
          ],
        },
      };
    });
  }, [data.id, updateNodeData]);

  return (
    <div className="flex flex-col gap-3 px-4">
      <BranchEditor
        currentNodeId={data.id}
        label="IF"
        branch={data.branches.if}
        onChange={updateIfBranch}
      />
      <Separator />
      {data.branches.elseIf?.map((branch, i) => (
        <div key={branch.id}>
          <BranchEditor
            currentNodeId={data.id}
            label={`ELSE IF ${i + 1}`}
            branch={branch}
            onChange={(updated) => {
              updateNodeData(data.id, (node) => {
                const prev = node.data as ConditionNodeData;
                return {
                  branches: {
                    ...prev.branches,
                    elseIf: prev.branches.elseIf?.map((b, idx) => (idx === i ? updated : b)),
                  },
                };
              });
            }}
            onDelete={() => {
              updateNodeData(data.id, (node) => {
                const prev = node.data as ConditionNodeData;
                return {
                  branches: {
                    ...prev.branches,
                    elseIf: prev.branches.elseIf?.filter((_, idx) => idx !== i),
                  },
                };
              });
            }}
          />
          <Separator className="mt-3" />
        </div>
      ))}
      <Button variant="secondary" className="w-full" onClick={addElseIfBranch}>
        <Plus className="size-4" /> ELSE IF
      </Button>
      <Separator />
      <div>
        <p className="text-xs font-bold text-primary">ELSE</p>
        <p className="text-xs text-muted-foreground mt-1">Executes when no other conditions match.</p>
      </div>
    </div>
  );
});
ConditionNodeConfig.displayName = "ConditionNodeConfig";

function BranchEditor({
  currentNodeId,
  label,
  branch,
  onChange,
  onDelete,
}: {
  currentNodeId: string;
  label: string;
  branch: ConditionBranch;
  onChange: (branch: ConditionBranch) => void;
  onDelete?: () => void;
}) {
  const nodes = useNodes() as UINode[];

  const addCondition = useCallback(
    (source: { nodeId: string; path: string[]; nodeName: string; type: string }) => {
      const node = nodes.find((n) => n.data.id === source.nodeId);
      const sourceSchema = node ? findJsonSchemaByPath(node.data.outputSchema, source.path) : undefined;
      onChange({
        ...branch,
        conditions: [
          ...branch.conditions,
          {
            source: { nodeId: source.nodeId, path: source.path },
            operator: getFirstConditionOperator((sourceSchema?.type as "string" | "number" | "boolean") || "string"),
            value: "",
          },
        ],
      });
    },
    [branch, onChange, nodes],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-primary">{label}</p>
        {onDelete && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onDelete}>
            <Trash2 className="size-3" /> Remove
          </Button>
        )}
      </div>

      {branch.conditions.map((condition, i) => (
        <ConditionRuleEditor
          key={i}
          currentNodeId={currentNodeId}
          rule={condition}
          nodes={nodes}
          onChange={(updated) => {
            onChange({
              ...branch,
              conditions: branch.conditions.map((c, idx) => (idx === i ? updated : c)),
            });
          }}
          onDelete={() => {
            onChange({
              ...branch,
              conditions: branch.conditions.filter((_, idx) => idx !== i),
            });
          }}
        />
      ))}

      {branch.conditions.length > 1 && (
        <button
          className="text-xs font-bold bg-primary text-primary-foreground rounded px-2 py-0.5 w-fit"
          onClick={() => onChange({ ...branch, logicalOperator: branch.logicalOperator === "AND" ? "OR" : "AND" })}
        >
          {branch.logicalOperator}
        </button>
      )}

      <VariableSelect
        currentNodeId={currentNodeId}
        allowedTypes={["string", "number", "boolean"]}
        onChange={addCondition}
      >
        <Button variant="outline" size="sm" className="text-xs border-dashed">
          <Plus className="size-3" /> Add Condition
        </Button>
      </VariableSelect>
    </div>
  );
}

function ConditionRuleEditor({
  currentNodeId,
  rule,
  nodes,
  onChange,
  onDelete,
}: {
  currentNodeId: string;
  rule: ConditionRule;
  nodes: UINode[];
  onChange: (rule: ConditionRule) => void;
  onDelete: () => void;
}) {
  const sourceNode = nodes.find((n) => n.data.id === rule.source.nodeId);
  const sourceSchema = sourceNode
    ? findJsonSchemaByPath(sourceNode.data.outputSchema, rule.source.path)
    : undefined;
  const itemType = sourceSchema?.type || "string";

  const operatorItems = useMemo(() => {
    let ops = StringConditionOperator;
    if (itemType === "number") ops = NumberConditionOperator;
    if (itemType === "boolean") ops = BooleanConditionOperator;
    return Object.entries(ops).map(([label, value]) => ({ label, value }));
  }, [itemType]);

  return (
    <div className="flex items-center gap-1 bg-secondary rounded-lg p-1.5">
      <VariableSelect
        currentNodeId={currentNodeId}
        onChange={(source) => onChange({ ...rule, source: { nodeId: source.nodeId, path: source.path } })}
      >
        <div className="cursor-pointer">
          <VariableMentionItem
            nodeName={sourceNode?.data.name || "Not Found"}
            path={rule.source.path}
            type={itemType}
            notFound={!sourceNode}
            className="max-w-32"
          />
        </div>
      </VariableSelect>

      <Select
        value={rule.operator}
        onChange={(value: string) => onChange({ ...rule, operator: value, value: undefined })}
        options={operatorItems}
        placeholder="Operator"
        className="w-24"
      />

      {(itemType === "string" || itemType === "number") && (
        <Input
          value={String(rule.value ?? "")}
          className="text-xs h-7 flex-1 min-w-0"
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
        />
      )}

      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onDelete}>
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}
