"use client";

import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import { Trash2, ExternalLink, EllipsisVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
import { resolveArtifactDisplayUrl } from "@/lib/artifacts/display-url";
import { ArtifactSummary } from "@/lib/artifacts/types";
import { ARTIFACT_TYPE_CONFIG } from "@/components/artifacts/artifact-type-config";

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
  const cfg = ARTIFACT_TYPE_CONFIG[artifact.type] ?? ARTIFACT_TYPE_CONFIG.file;
  const Icon = cfg.icon;
  const { url: displayUrl, usable } = resolveArtifactDisplayUrl(artifact.url);
  const showThumbnail = artifact.type === "image" && usable;
  const modified = formatRelativeTime(artifact.createdAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className="group flex h-full flex-col"
    >
      {/* The tile is the whole visual weight; the caption sits outside it so
          the grid reads as a wall of thumbnails rather than a wall of boxes. */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-card-border bg-hover-bg transition-all duration-200 group-hover:border-primary/25 group-hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] dark:group-hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]">
        {showThumbnail ? (
          // The src is a presigned URL whose host is deployment config, so it
          // cannot go through next/image's remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt={artifact.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            role="img"
            aria-label={cfg.label}
            title={cfg.label}
            className="flex h-full w-full items-center justify-center"
          >
            <Icon className={cn("h-12 w-12", cfg.iconColorClass)} />
          </div>
        )}

        {/* Revealed on hover and on keyboard focus, with its own surface so it
            stays legible over an arbitrary image. */}
        <div className="absolute right-2 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Artifact actions"
                className="rounded-md border border-card-border bg-card-bg/90 p-1 text-text-secondary backdrop-blur-sm transition-colors hover:text-foreground"
              >
                <EllipsisVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44 border-card-border bg-card-bg shadow-lg"
            >
              {usable && (
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
      </div>

      <div className="mt-2.5 flex flex-col gap-0.5">
        <p className="line-clamp-2 text-sm leading-snug text-foreground">
          {artifact.title}
        </p>
        {modified && (
          <span className="truncate text-xs text-text-secondary">
            Modified {modified}
          </span>
        )}
      </div>
    </motion.div>
  );
}
