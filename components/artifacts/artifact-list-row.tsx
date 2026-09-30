"use client";

import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import { EllipsisVertical, ExternalLink, Trash2 } from "lucide-react";
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

/**
 * Column geometry, shared with the `Name` / `Last activity` header that
 * `artifacts-content.tsx` renders above these rows, so the two cannot drift
 * out of alignment. The actions width is the menu button; the header renders
 * it as an empty spacer.
 */
export const LIST_THUMB_WIDTH = "w-10";
export const LIST_ACTIVITY_WIDTH = "w-32";
export const LIST_ACTIONS_WIDTH = "w-6";

interface ArtifactListRowProps {
  artifact: ArtifactSummary;
  index?: number;
  onDelete: (e: MouseEvent) => void;
}

/**
 * The list half of the Library's grid/list toggle. Deliberately the same props
 * contract as `ArtifactCard`, so `artifacts-content.tsx` can swap one for the
 * other without the delete flow knowing which it is rendering.
 *
 * Unlike the card, the actions menu stays visible rather than revealing on
 * hover: in a dense row the ellipsis is the only affordance, and hiding it
 * would leave the row looking inert.
 */
export function ArtifactListRow({
  artifact,
  index = 0,
  onDelete,
}: ArtifactListRowProps) {
  const cfg = ARTIFACT_TYPE_CONFIG[artifact.type] ?? ARTIFACT_TYPE_CONFIG.file;
  const Icon = cfg.icon;
  const { url: displayUrl, usable } = resolveArtifactDisplayUrl(artifact.url);
  const modified = formatRelativeTime(artifact.createdAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.2,
        delay: index * 0.02,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className="group flex items-center gap-3 border-b border-card-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-hover-bg"
    >
      <div
        className={cn(
          "flex aspect-square shrink-0 items-center justify-center overflow-hidden rounded-md border border-card-border bg-hover-bg",
          LIST_THUMB_WIDTH,
        )}
      >
        {artifact.type === "image" && usable ? (
          // Presigned URL with a deployment-configured host — see artifact-card.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <Icon
            className={cn("h-4 w-4", cfg.iconColorClass)}
            aria-label={cfg.label}
          />
        )}
      </div>

      <p className="min-w-0 flex-1 truncate text-sm text-foreground">
        {artifact.title}
      </p>

      <span
        className={cn(
          "hidden shrink-0 text-right text-xs text-text-secondary sm:block",
          LIST_ACTIVITY_WIDTH,
        )}
      >
        {modified && `Modified ${modified}`}
      </span>

      <div
        className={cn(
          "flex shrink-0 justify-center",
          LIST_ACTIONS_WIDTH,
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Artifact actions"
              className="rounded-md p-0.5 text-text-secondary/50 transition-colors hover:bg-card-bg hover:text-text-secondary"
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
    </motion.div>
  );
}
