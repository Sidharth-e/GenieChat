"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ArtifactsView = "grid" | "list";

export const ARTIFACTS_VIEWS: {
  id: ArtifactsView;
  label: string;
  icon: typeof List;
}[] = [
  { id: "grid", label: "Grid view", icon: LayoutGrid },
  { id: "list", label: "List view", icon: List },
];

interface ArtifactsViewToggleProps {
  view: ArtifactsView;
  onChange: (view: ArtifactsView) => void;
}

/**
 * A segmented control rather than an icon button that cycles: two options that
 * are both always reachable is the point, and `aria-pressed` on each tells a
 * screen reader which one is on without a separate live region.
 */
export function ArtifactsViewToggle({
  view,
  onChange,
}: ArtifactsViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Artifact layout"
      className="flex shrink-0 items-center gap-1"
    >
      {ARTIFACTS_VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          aria-label={label}
          title={label}
          onClick={() => onChange(id)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            view === id
              ? "bg-active-bg text-foreground"
              : "text-text-secondary hover:bg-hover-bg hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
