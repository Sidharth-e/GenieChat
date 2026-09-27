"use client";

import { NodeKind } from "@/lib/workflow/types";
import { useReactFlow } from "@xyflow/react";
import { Copy, CopyPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NodeContextMenuProps {
  nodeId: string;
  nodeKind: NodeKind;
  children: React.ReactNode;
  onDuplicate?: () => void;
}

export function NodeContextMenu({
  nodeId,
  nodeKind,
  children,
  onDuplicate,
}: NodeContextMenuProps) {
  const { setNodes, setEdges } = useReactFlow();

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(nodeId);
      toast("Node ID copied");
    } catch {
      // Fallback for environments where clipboard API is unavailable
      toast.error("Failed to copy node ID");
    }
  };

  const handleDelete = () => {
    if (nodeKind === NodeKind.Input || nodeKind === NodeKind.Output) {
      toast.warning("This node cannot be deleted");
      return;
    }

    setNodes((nodes) => nodes.filter((n) => n.id !== nodeId));
    setEdges((edges) =>
      edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={handleCopyId}>
          <Copy className="mr-2 h-4 w-4" />
          Copy ID
        </DropdownMenuItem>

        {onDuplicate && (
          <DropdownMenuItem onSelect={onDuplicate}>
            <CopyPlus className="mr-2 h-4 w-4" />
            Duplicate
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={nodeKind === NodeKind.Input || nodeKind === NodeKind.Output}
          onSelect={handleDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
