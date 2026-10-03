import type { RichWorkflow } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  FolderGit2,
  Play,
  ChevronRight,
  Clock,
  Pen,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/relative-time";

interface WorkflowListItemProps {
  workflow: RichWorkflow;
  onExecute: (workflow: RichWorkflow) => void;
  onDelete: (workflowId: string) => void;
}

export function WorkflowListItem({
  workflow,
  onExecute,
  onDelete,
}: WorkflowListItemProps) {
  const viewHref = `/workflow/${workflow.id}/view/node-workflow`;
  const editHref = `/workflow/${workflow.id}/edit/node-workflow`;

  const nodeCountText = `${workflow.nodes.length} nodes`;

  const updatedTime = formatRelativeTime(
    workflow.updatedAt || workflow.createdAt,
  );

  return (
    <article
      className={cn(
        "group rounded-sm border border-card-border bg-card-bg p-4 transition-colors duration-200",
        "hover:border-tertiary/40",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-tertiary/5 text-foreground">
          <FolderGit2 className="h-4 w-4" />
        </div>

        <Link
          href={viewHref}
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors hover:underline"
        >
          {workflow.name}
        </Link>

        <span className="shrink-0 pill-blue">Node Workflow</span>
      </div>

      <p className="mt-2 line-clamp-2 pl-11 text-xs leading-relaxed text-text-secondary">
        {workflow.description || "No description provided."}
      </p>

      <div className="mt-3 flex items-center gap-2 border-t border-card-border/60 pt-2.5 pl-11">
        <div className="flex items-center gap-3 font-mono text-[10px] text-tertiary/40">
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {nodeCountText}
          </span>
          {updatedTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {updatedTime}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onExecute(workflow);
            }}
            className="h-7 rounded-sm border border-card-border bg-tertiary/5 px-2.5 text-[11px] font-medium text-foreground hover:bg-tertiary/10 transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Play className="h-3 w-3" />
            Run
          </button>

          <Link href={editHref}>
            <button
              type="button"
              className="h-7 rounded-sm px-2 text-[11px] text-tertiary/40 hover:text-foreground transition-colors flex items-center cursor-pointer"
              aria-label="Edit workflow"
            >
              <Pen className="h-3.5 w-3.5" />
            </button>
          </Link>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onDelete(workflow.id);
            }}
            className="h-7 rounded-sm px-2 text-[11px] text-tertiary/40 hover:text-[var(--red)] transition-colors flex items-center cursor-pointer"
            title="Delete workflow"
            aria-label="Delete workflow"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          <Link href={viewHref}>
            <button
              type="button"
              className="h-7 rounded-sm px-1.5 text-[11px] text-tertiary/40 hover:text-foreground transition-colors flex items-center cursor-pointer"
              aria-label="View workflow"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </div>
    </article>
  );
}
