import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import {
  Copy,
  Trash2,
  Pencil,
  Share2,
  Heart,
  FileText,
  EllipsisVertical,
  Tags,
  Globe,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Prompt } from "@/lib/types";

interface PromptCardProps {
  prompt: Prompt;
  index?: number;
  isFavorite: boolean;
  showQuickActions?: boolean;
  onEdit: (e: MouseEvent) => void;
  onCopy: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
  onShare: (e: MouseEvent) => void;
  onFavoriteToggle: (e: MouseEvent) => void;
}

export function PromptCard({
  prompt,
  index = 0,
  isFavorite,
  showQuickActions = true,
  onEdit,
  onCopy,
  onDelete,
  onShare,
  onFavoriteToggle,
}: PromptCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={cn(
        "group relative flex h-full flex-col rounded-lg border border-card-border bg-card-bg px-3.5 py-3",
        "transition-all duration-200",
        "hover:-translate-y-px hover:border-primary/25 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)]",
        "dark:hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            prompt.isShared
              ? "bg-primary/10 text-primary"
              : "bg-primary/10 text-primary",
          )}
        >
          <FileText className="h-3.5 w-3.5" />
        </div>

        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-foreground">
          {prompt.title}
        </h3>

        {prompt.isShared && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-primary/8 px-1 py-px text-[10px] font-medium text-primary">
            <Globe className="h-2.5 w-2.5" />
            Shared
          </span>
        )}

        {showQuickActions && (
          <button
            type="button"
            className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-hover-bg"
            onClick={(e) => {
              e.stopPropagation();
              onFavoriteToggle(e);
            }}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart
              className={cn(
                "h-3 w-3 transition-colors",
                isFavorite
                  ? "fill-red-500 text-red-500"
                  : "text-text-secondary/40 hover:text-red-400",
              )}
            />
          </button>
        )}
      </div>

      <p className="mt-1.5 min-h-10 line-clamp-2 text-xs leading-relaxed text-text-secondary">
        {prompt.content}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-card-border pt-2">
        <span className="truncate rounded bg-hover-bg px-1.5 py-px font-mono text-[10px] text-text-secondary">
          {prompt.tags.length} {prompt.tags.length === 1 ? "tag" : "tags"}
        </span>

        {prompt.tags.length > 0 && (
          <span
            className="max-w-[120px] truncate rounded bg-hover-bg/70 px-1.5 py-px text-[10px] text-text-secondary/80"
            title={prompt.tags.join(", ")}
          >
            <span className="inline-flex items-center gap-0.5">
              <Tags className="h-2.5 w-2.5" />
              {prompt.tags[0]}
            </span>
          </span>
        )}

        {showQuickActions && (
          <>
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
                  <Pencil className="h-3.5 w-3.5 text-text-secondary" />
                  Edit prompt
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-xs"
                  onClick={(e) => onCopy(e)}
                >
                  <Copy className="h-3.5 w-3.5 text-text-secondary" />
                  Copy content
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-xs"
                  onClick={(e) => onShare(e)}
                >
                  <Share2
                    className={cn(
                      "h-3.5 w-3.5",
                      prompt.isShared ? "text-primary" : "text-text-secondary",
                    )}
                  />
                  {prompt.isShared ? "Manage sharing" : "Share prompt"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-xs text-red-500 focus:text-red-500"
                  onClick={(e) => onDelete(e)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete prompt
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </motion.div>
  );
}
