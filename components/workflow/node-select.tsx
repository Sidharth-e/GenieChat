"use client";

import { type ReactNode } from "react";
import { NodeKind } from "@/lib/workflow/types";
import { NodeIcon } from "@/components/workflow/node-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NODE_DESCRIPTIONS: Record<NodeKind, string> = {
  [NodeKind.Input]: "Define input fields for your workflow",
  [NodeKind.LLM]: "Call an LLM with custom messages and model",
  [NodeKind.Condition]: "Branch based on conditions (IF/ELSE)",
  [NodeKind.Note]: "Add notes visible only in the editor",
  [NodeKind.Tool]: "Execute an MCP or app tool",
  [NodeKind.Http]: "Make HTTP requests to external APIs",
  [NodeKind.Template]: "Compose text with variable references",
  [NodeKind.Code]: "Run custom code (coming soon)",
  [NodeKind.Output]: "Define the workflow output",
};

const DISPLAY_NAMES: Record<NodeKind, string> = {
  [NodeKind.Input]: "Input",
  [NodeKind.LLM]: "LLM",
  [NodeKind.Condition]: "Condition",
  [NodeKind.Note]: "Note",
  [NodeKind.Tool]: "Tool",
  [NodeKind.Http]: "HTTP",
  [NodeKind.Template]: "Template",
  [NodeKind.Code]: "Code",
  [NodeKind.Output]: "Output",
};

/** Node kinds available in the add-node dropdown (Input is excluded). */
const SELECTABLE_KINDS = Object.values(NodeKind).filter(
  (k) => k !== NodeKind.Input,
);

interface NodeSelectProps {
  children: ReactNode;
  onChange: (kind: NodeKind) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NodeSelect({
  children,
  onChange,
  open,
  onOpenChange,
}: NodeSelectProps) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <NodeSelectContent onChange={onChange} />
    </DropdownMenu>
  );
}

export function NodeSelectContent({
  onChange,
}: {
  onChange: (kind: NodeKind) => void;
}) {
  return (
    <DropdownMenuContent
      side="bottom"
      align="start"
      className="w-64 bg-secondary border-card-border"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {SELECTABLE_KINDS.map((kind) => {
        const disabled = kind === NodeKind.Code;

        return (
          <DropdownMenuItem
            key={kind}
            disabled={disabled}
            onSelect={() => onChange(kind)}
            className="flex items-center gap-2.5 py-2"
          >
            <NodeIcon type={kind} />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">
                {DISPLAY_NAMES[kind]}
                {disabled && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    Soon...
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {NODE_DESCRIPTIONS[kind]}
              </span>
            </div>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}
