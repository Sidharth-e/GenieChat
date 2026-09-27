"use client";

import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import { Brain, Pencil, Trash2, EllipsisVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Memory, MemoryCategory } from "@/lib/types";

const categoryColors: Record<MemoryCategory, string> = {
  preference: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  fact: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  instruction: "bg-green-500/20 text-green-400 border-green-500/30",
  professional: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  other: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const categoryLabels: Record<MemoryCategory, string> = {
  preference: "Preference",
  fact: "Fact",
  instruction: "Instruction",
  professional: "Professional",
  other: "Other",
};

interface MemoryCardProps {
  memory: Memory;
  index?: number;
  onEdit: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
}

export function MemoryCard({
  memory,
  index = 0,
  onEdit,
  onDelete,
}: MemoryCardProps) {
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
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Brain className="h-3.5 w-3.5" />
        </div>

        {memory.category && (
          <span
            className={cn(
              "rounded px-1.5 py-px text-[10px] font-medium border",
              categoryColors[memory.category],
            )}
          >
            {categoryLabels[memory.category]}
          </span>
        )}

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-md p-0.5 text-text-secondary/50 transition-colors hover:bg-hover-bg hover:text-text-secondary"
            >
              <EllipsisVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 border-card-border bg-card-bg shadow-lg"
          >
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-xs"
              onClick={(e) => onEdit(e)}
            >
              <Pencil className="h-3.5 w-3.5 text-text-secondary" />
              Edit memory
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-xs text-red-500 focus:text-red-500"
              onClick={(e) => onDelete(e)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete memory
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="mt-1.5 min-h-10 line-clamp-3 text-xs leading-relaxed text-text-secondary">
        {memory.content}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-card-border pt-2">
        <span className="truncate rounded bg-hover-bg px-1.5 py-px font-mono text-[10px] text-text-secondary">
          {new Date(memory.createdAt).toLocaleDateString()}
        </span>
        <span className="text-[10px] text-text-secondary/60">
          {memory.content.length} chars
        </span>
      </div>
    </motion.div>
  );
}
