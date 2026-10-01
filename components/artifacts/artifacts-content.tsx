"use client";

import * as React from "react";
import { AlertCircle, FileBox } from "lucide-react";
import { useArtifacts, useDeleteArtifact } from "@/hooks/use-artifacts-queries";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import {
  ArtifactListRow,
  LIST_THUMB_WIDTH,
  LIST_ACTIVITY_WIDTH,
  LIST_ACTIONS_WIDTH,
} from "@/components/artifacts/artifact-list-row";
import {
  ArtifactsViewToggle,
  ArtifactsView,
} from "@/components/artifacts/artifacts-view-toggle";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { ContentLayout } from "@/components/common/content-layout";
import { ContentFilterPills } from "@/components/common/content-filter-pills";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "image", label: "Images" },
  { value: "chart", label: "Charts" },
  { value: "mermaid", label: "Diagrams" },
  { value: "canvas", label: "Canvas" },
  { value: "code_sandbox", label: "Code Output" },
  { value: "file", label: "Files" },
];

export function ArtifactsContent() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [view, setView] = React.useState<ArtifactsView>("grid");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);

  const {
    data: artifacts = [],
    isLoading,
    error,
  } = useArtifacts(searchQuery, typeFilter || undefined);
  const deleteArtifactMutation = useDeleteArtifact();

  const handleDelete = async (id: string) => {
    await deleteArtifactMutation.mutateAsync(id);
    setShowDeleteConfirm(null);
  };

  const requestDelete = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(id);
  };

  return (
    <ContentLayout
      title="Artifacts"
      searchPlaceholder="Search artifacts..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={<ArtifactsViewToggle view={view} onChange={setView} />}
      navigation={
        <ContentFilterPills
          ariaLabel="Filter artifacts by type"
          options={TYPE_FILTERS}
          value={typeFilter}
          onChange={setTypeFilter}
        />
      }
    >
      {isLoading && artifacts.length === 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[4/3] w-full rounded-lg border border-card-border bg-hover-bg" />
              <div className="mt-2.5 space-y-1.5">
                <div className="h-4 w-2/3 rounded bg-hover-bg" />
                <div className="h-3 w-1/3 rounded bg-hover-bg" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load artifacts"}
          </span>
        </div>
      ) : artifacts.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <FileBox className="mx-auto h-10 w-10 text-text-secondary/40" />
          <h3 className="mt-3 text-base font-semibold text-foreground">
            No artifacts yet
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery || typeFilter
              ? "Try a different search or filter."
              : "Generated images, charts, diagrams, and files will appear here."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {artifacts.map((artifact, i) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              index={i}
              onDelete={requestDelete(artifact.id)}
            />
          ))}
        </div>
      ) : (
        <div>
          {/* Column names, sharing the row's geometry so the two stay aligned. */}
          <div className="flex items-center gap-3 border-b border-card-border px-3 pb-2 text-xs text-text-secondary">
            <span className={cn("shrink-0", LIST_THUMB_WIDTH)} aria-hidden />
            <span className="flex-1">Name</span>
            <span
              className={cn(
                "hidden shrink-0 text-right sm:block",
                LIST_ACTIVITY_WIDTH,
              )}
            >
              Last activity
            </span>
            <span className={cn("shrink-0", LIST_ACTIONS_WIDTH)} aria-hidden />
          </div>

          {artifacts.map((artifact, i) => (
            <ArtifactListRow
              key={artifact.id}
              artifact={artifact}
              index={i}
              onDelete={requestDelete(artifact.id)}
            />
          ))}
        </div>
      )}

      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={deleteArtifactMutation.isPending}
        title="Delete Artifact"
        description="Are you sure you want to delete this artifact? This action cannot be undone."
        dialogClassName="border border-card-border"
      />
    </ContentLayout>
  );
}
