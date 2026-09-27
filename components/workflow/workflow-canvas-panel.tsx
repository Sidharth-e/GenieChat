"use client";

import { memo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  AlignHorizontalSpaceAround,
  Play,
  Save,
  Loader2,
  Globe,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SelectedNodeConfig } from "@/components/workflow/selected-node-config";
import { ExecuteTab } from "@/components/workflow/node-config/execute-tab";
import type { RichWorkflow } from "@/lib/types";
import type { UINode } from "@/lib/workflow/types";

interface WorkflowCanvasPanelProps {
  workflow: RichWorkflow;
  selectedNode?: UINode;
  isProcessing: boolean;
  hasEditAccess: boolean;
  onSave: () => Promise<void>;
  autoRun?: boolean;
}

export const WorkflowCanvasPanel = memo(function WorkflowCanvasPanel({
  workflow,
  selectedNode,
  isProcessing,
  hasEditAccess,
  onSave,
  autoRun,
}: WorkflowCanvasPanelProps) {
  const [showExecuteTab, setShowExecuteTab] = useState(autoRun ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const { setNodes } = useReactFlow<UINode>();

  const handleToggleExecuteTab = () => {
    if (showExecuteTab) {
      setShowExecuteTab(false);
    } else {
      // Deselect all nodes when opening the execute tab
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
      setShowExecuteTab(true);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseExecuteTab = () => {
    if (!isProcessing) {
      setShowExecuteTab(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Button bar */}
      <div className="flex items-center gap-1 bg-card/90 backdrop-blur-xl border rounded-xl px-2 py-1.5 shadow-lg">
        {/* Workflow name label */}
        <span className="text-sm font-semibold px-2 truncate max-w-48">
          {workflow.name}
        </span>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Arrange button (placeholder) */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled>
                <AlignHorizontalSpaceAround className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Arrange nodes</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Run button */}
        <Button
          variant={showExecuteTab ? "secondary" : "ghost"}
          size="sm"
          onClick={handleToggleExecuteTab}
        >
          <Play className="size-3.5" />
          Run
        </Button>

        {/* Save button — only shown when not published */}
        {!workflow.isPublished && hasEditAccess && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isProcessing}
          >
            {isSaving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        )}

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Publish/Edit toggle */}
        {workflow.isPublished ? (
          <Button variant="outline" size="sm" disabled>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <Globe className="size-3.5" />
            Publish
          </Button>
        )}
      </div>

      {/* Panels below the button bar */}
      <div className="flex gap-2">
        {selectedNode && !showExecuteTab && (
          <SelectedNodeConfig node={selectedNode} />
        )}
        {showExecuteTab && (
          <ExecuteTab close={handleCloseExecuteTab} onSave={onSave} />
        )}
      </div>
    </div>
  );
});
WorkflowCanvasPanel.displayName = "WorkflowCanvasPanel";
