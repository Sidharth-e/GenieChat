"use client";

import * as React from "react";
import { AlertCircle, FileBox } from "lucide-react";
import { useArtifacts, useDeleteArtifact } from "@/hooks/use-artifacts-queries";
import { ArtifactType } from "@/lib/artifacts/types";
import { ArtifactCard } from "@/components/artifacts/artifact-card";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { ContentLayout } from "@/components/common/content-layout";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "image", label: "Images" },
  { value: "chart", label: "Charts" },
  { value: "mermaid", label: "Diagrams" },
  { value: "canvas", label: "Canvas" },
  { value: "code_interpreter", label: "Code Output" },
  { value: "file", label: "Files" },
];

export function ArtifactsContent() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<string | null>(null);

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

  return (
    <ContentLayout
      title="Artifacts"
      description="Browse all generated images, charts, diagrams, and files from your conversations"
      searchPlaceholder="Search artifacts..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      navigation={
        <div className="flex gap-1 overflow-x-auto pb-2">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setTypeFilter(filter.value)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                typeFilter === filter.value
                  ? "bg-primary text-primary-foreground"
                  : "text-text-secondary hover:bg-hover-bg",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      }
    >
      {isLoading && artifacts.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-card-border bg-card-bg animate-pulse"
            >
              <div className="h-36 w-full bg-hover-bg" />
              <div className="p-3.5">
                <div className="mb-2 h-4 w-2/3 rounded bg-hover-bg" />
                <div className="mb-1.5 h-3 w-full rounded bg-hover-bg" />
                <div className="mt-3 h-3 w-1/3 rounded bg-hover-bg" />
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
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {artifacts.map((artifact, i) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              index={i}
              onDelete={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(artifact.id);
              }}
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
