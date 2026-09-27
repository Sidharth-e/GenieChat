"use client";

import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import {
  Image,
  FileCode,
  BarChart3,
  GitBranch,
  Component,
  File,
  Trash2,
  ExternalLink,
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
import { isStorageRef } from "@/lib/storage/ref";
import { ArtifactSummary, ArtifactType } from "@/lib/artifacts/types";

const typeConfig: Record<
  ArtifactType,
  { icon: typeof Image; label: string; colorClass: string }
> = {
  image: {
    icon: Image,
    label: "Image",
    colorClass: "bg-[var(--purple)]/15 text-[var(--purple)] border-[var(--purple)]/30",
  },
  file: {
    icon: File,
    label: "File",
    colorClass: "bg-[var(--blue)]/15 text-[var(--blue)] border-[var(--blue)]/30",
  },
  chart: {
    icon: BarChart3,
    label: "Chart",
    colorClass: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30",
  },
  mermaid: {
    icon: GitBranch,
    label: "Diagram",
    colorClass: "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30",
  },
  canvas: {
    icon: Component,
    label: "Canvas",
    colorClass: "bg-[var(--blue)]/15 text-[var(--blue)] border-[var(--blue)]/30",
  },
  code_interpreter: {
    icon: FileCode,
    label: "Code Output",
    colorClass: "bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30",
  },
};

interface ArtifactCardProps {
  artifact: ArtifactSummary;
  index?: number;
  onDelete: (e: MouseEvent) => void;
}

export function ArtifactCard({
  artifact,
  index = 0,
  onDelete,
}: ArtifactCardProps) {
  const cfg = typeConfig[artifact.type] || typeConfig.file;
  const Icon = cfg.icon;
  // One derived URL for every consumer below: the presigned URL when signing
  // worked, the proxy route when the value came back as a bare ref.
  const displayUrl = isStorageRef(artifact.url)
    ? `/api/storage/download?ref=${encodeURIComponent(artifact.url)}`
    : artifact.url;
  // An allowlist, not a non-empty test: a row whose value is neither a ref nor
  // `http(s)` (a bare `generated-images/…` path, say) must fall back to the icon
  // rather than render `<img src="…">` or offer "Open in new tab".
  const hasUrl =
    isStorageRef(artifact.url) || /^https?:\/\//.test(artifact.url);
  const isImage = artifact.type === "image" && hasUrl;

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
        "group relative flex h-full flex-col overflow-hidden rounded-lg border border-card-border bg-card-bg",
        "transition-all duration-200",
        "hover:-translate-y-px hover:border-primary/25 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)]",
        "dark:hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]",
      )}
    >
      {isImage ? (
        <div className="relative h-36 w-full overflow-hidden bg-hover-bg">
          <img
            src={displayUrl}
            alt={artifact.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex h-36 w-full items-center justify-center bg-hover-bg">
          <Icon className="h-10 w-10 text-text-secondary/30" />
        </div>
      )}

      <div className="flex flex-1 flex-col px-3.5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>

          <span
            className={cn(
              "rounded px-1.5 py-px text-[10px] font-medium border",
              cfg.colorClass,
            )}
          >
            {cfg.label}
          </span>

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
              {hasUrl && (
                <>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-xs"
                    onClick={() => window.open(displayUrl, "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-text-secondary" />
                    Open in new tab
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-xs text-red-500 focus:text-red-500"
                onClick={(e) => onDelete(e)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete artifact
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">
          {artifact.title}
        </p>

        <div className="mt-auto flex items-center gap-1.5 border-t border-card-border pt-2">
          <span className="truncate rounded bg-hover-bg px-1.5 py-px font-mono text-[10px] text-text-secondary">
            {new Date(artifact.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
