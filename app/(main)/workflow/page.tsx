"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useWorkflows, useDeleteWorkflow } from "@/hooks/use-workflows-queries";
import { Workflow, RichWorkflow } from "@/lib/types";
import { WorkflowHeader } from "@/components/workflow/workflow-header";
import { WorkflowList } from "@/components/workflow/workflow-list";
import { WorkflowEmptyState } from "@/components/workflow/workflow-empty-state";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";

export default function WorkflowPage() {
  // Server state from React Query
  const { data: workflows = [], isLoading, error } = useWorkflows();
  const deleteWorkflowMutation = useDeleteWorkflow();

  // UI State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");

  const handleExecuteWorkflow = (workflow: Workflow | RichWorkflow) => {
    const type = "nodes" in workflow ? "node-workflow" : "agentic-workflow";
    window.location.href = `/workflow/${workflow.id}/view/${type}?autoRun=true`;
  };

  const handleDeleteWorkflow = async () => {
    if (!showDeleteConfirm) return;

    await deleteWorkflowMutation.mutateAsync(showDeleteConfirm);
    setShowDeleteConfirm(null);
  };

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = searchQuery.toLowerCase();
    return (
      workflow.name.toLowerCase().includes(query) ||
      (workflow.description?.toLowerCase().includes(query) ?? false)
    );
  });

  return (
    <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 pb-10 pt-14 md:px-8 md:pt-20 animate-in fade-in duration-300">
      <WorkflowHeader
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      <div className="pt-5">
        {isLoading && workflows.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-card-border bg-card-bg p-4 animate-pulse"
              >
                <div className="mb-2 h-4 w-1/2 rounded bg-hover-bg" />
                <div className="mb-2 h-3 w-2/3 rounded bg-hover-bg" />
                <div className="h-8 w-full rounded border border-card-border bg-secondary/50" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-sm border border-[var(--red-border)] bg-[var(--red-bg)] p-4 text-sm text-[var(--red)]">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>
              {error instanceof Error
                ? error.message
                : "Failed to load workflows"}
            </span>
          </div>
        )}

        {!isLoading && workflows.length === 0 && !error && (
          <WorkflowEmptyState />
        )}

        {filteredWorkflows.length > 0 && (
          <WorkflowList
            workflows={filteredWorkflows}
            onExecute={handleExecuteWorkflow}
            onDelete={setShowDeleteConfirm}
          />
        )}

        {!isLoading &&
          !error &&
          workflows.length > 0 &&
          filteredWorkflows.length === 0 && (
            <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
              <h3 className="text-base font-semibold text-foreground">
                No results found
              </h3>
              <p className="mt-1 text-sm text-text-secondary">
                Try adjusting your search query.
              </p>
            </div>
          )}
      </div>

      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={handleDeleteWorkflow}
        isDeleting={deleteWorkflowMutation.isPending}
        title="Delete Workflow"
        description="Are you sure you want to delete this workflow? This action cannot be undone."
      />
    </div>
  );
}
