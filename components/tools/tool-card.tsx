import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import {
  Code,
  Pen,
  Trash2,
  Power,
  PowerOff,
  Settings,
  EllipsisVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CustomTool } from "@/lib/types";

interface ToolCardProps {
  tool: CustomTool;
  index?: number;
  onToggle: (e: MouseEvent) => void;
  onEdit: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
  onView: () => void;
  isUsedInAgent?: boolean;
}

export function ToolCard({
  tool,
  index = 0,
  onToggle,
  onEdit,
  onDelete,
  onView,
  isUsedInAgent,
}: ToolCardProps) {
  const cannotDelete = isUsedInAgent;
  const cannotDisable = isUsedInAgent && tool.enabled;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView();
        }
      }}
      onClick={onView}
      className={cn(
        "group relative flex h-full flex-col rounded-lg border border-card-border bg-card-bg px-3.5 py-3",
        "transition-all duration-200 cursor-pointer",
        "hover:-translate-y-px hover:border-primary/25 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)]",
        "dark:hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]",
        !tool.enabled && "opacity-45 saturate-50",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Code className="h-3.5 w-3.5" />
          {tool.enabled && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-[1.5px] border-card-bg bg-primary" />
          )}
        </div>

        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-foreground">
          {tool.name}
        </h3>

        <span
          className={cn(
            "flex shrink-0 items-center rounded px-1 py-px text-[10px] font-medium",
            tool.enabled
              ? "bg-primary/8 text-primary"
              : "bg-hover-bg text-text-secondary",
          )}
        >
          {tool.enabled ? "Active" : "Disabled"}
        </span>
      </div>

      <p className="mt-1.5 min-h-10 line-clamp-2 text-xs leading-relaxed text-text-secondary">
        {tool.description || "No description provided."}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-card-border pt-2">
        <span className="truncate rounded bg-hover-bg px-1.5 py-px font-mono text-[10px] text-text-secondary">
          {tool.code.length} chars
        </span>
        <span className="flex items-center gap-0.5 text-[10px] text-text-secondary/60">
          <Settings className="h-2.5 w-2.5" />
          {tool.parameters.length}
        </span>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md p-0.5 text-text-secondary/50 transition-colors hover:bg-hover-bg hover:text-text-secondary"
              onClick={(e) => e.stopPropagation()}
            >
              <EllipsisVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 border-card-border bg-card-bg shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-xs"
              onClick={(e) => onEdit(e)}
            >
              <Pen className="h-3.5 w-3.5 text-text-secondary" />
              Edit tool
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "cursor-pointer gap-2 text-xs",
                cannotDisable && "opacity-50",
              )}
              disabled={!!cannotDisable}
              onClick={(e) => {
                if (!cannotDisable) onToggle(e);
              }}
            >
              {tool.enabled ? (
                <PowerOff className="h-3.5 w-3.5 text-text-secondary" />
              ) : (
                <Power className="h-3.5 w-3.5 text-text-secondary" />
              )}
              <div>
                <div>{tool.enabled ? "Disable tool" : "Enable tool"}</div>
                {cannotDisable && (
                  <div className="text-[10px] text-text-secondary">
                    Used in an agent
                  </div>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={cn(
                "cursor-pointer gap-2 text-xs text-red-500 focus:text-red-500",
                cannotDelete && "opacity-50",
              )}
              disabled={!!cannotDelete}
              onClick={(e) => {
                if (!cannotDelete) onDelete(e);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <div>
                <div>Delete tool</div>
                {cannotDelete && (
                  <div className="text-[10px] text-text-secondary">
                    Used in an agent
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}
