"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, AlertCircle } from "lucide-react";
import {
  useTools,
  useDeleteTool,
  useToggleTool,
} from "@/hooks/use-tools-queries";
import { useAgents } from "@/hooks/use-agents-queries";
import { CustomTool } from "@/lib/types";
import { ToolCard } from "@/components/tools/tool-card";
import { ToolDetailDialog } from "@/components/tools/tool-detail-dialog";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";

import { ContentLayout } from "@/components/common/content-layout";

interface ToolsContentProps {
  initialTools?: CustomTool[];
}

export function ToolsContent({ initialTools }: ToolsContentProps) {
  const router = useRouter();

  // Server state from React Query
  const {
    data: tools = initialTools ?? [],
    isLoading,
    error,
  } = useTools(initialTools);
  const { data: agents = [] } = useAgents();
  const deleteToolMutation = useDeleteTool();
  const toggleToolMutation = useToggleTool();

  // UI State
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isViewDialogOpen, setIsViewDialogOpen] = React.useState(false);
  const [selectedTool, setSelectedTool] = React.useState<CustomTool | null>(
    null,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);

  const handleCreate = () => {
    router.push("/tools/new");
  };

  const handleEdit = (tool: CustomTool) => {
    router.push(`/tools/${tool.id}/edit`);
  };

  const handleDelete = async (id: string) => {
    await deleteToolMutation.mutateAsync(id);
    setShowDeleteConfirm(null);
  };

  const handleToggle = async (tool: CustomTool, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await toggleToolMutation.mutateAsync({
      id: tool.id,
      enabled: !tool.enabled,
    });
  };

  const handleViewTool = (tool: CustomTool) => {
    setSelectedTool(tool);
    setIsViewDialogOpen(true);
  };

  const filteredTools = tools.filter((tool) => {
    const query = searchQuery.toLowerCase();
    return (
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query)
    );
  });

  const isToolUsedInAgent = (tool: CustomTool) => {
    const aliases = [
      `custom:${tool.id}`,
      `custom:${tool.name}`,
      tool.id,
      tool.name,
      tool.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, ""),
    ];
    return agents.some((agent) =>
      agent.tools?.some((t) => aliases.includes(t)),
    );
  };

  return (
    <ContentLayout
      title="Custom Tools"
      description="Define custom JavaScript tools for your AI workflows"
      searchPlaceholder="Search tools..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={
        <Button
          onClick={handleCreate}
          className="h-10 rounded-md px-4 shadow-none hover:scale-100"
        >
          New Tool
          <Plus className="ml-2 h-4 w-4" />
        </Button>
      }
    >
      {isLoading && tools.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-md border border-card-border bg-card-bg p-4 animate-pulse"
            >
              <div className="mb-2 h-4 w-2/3 rounded bg-hover-bg" />
              <div className="mb-1.5 h-3 w-full rounded bg-hover-bg" />
              <div className="mb-4 h-3 w-5/6 rounded bg-hover-bg" />
              <div className="h-8 w-full rounded border border-card-border bg-secondary/50" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load tools"}
          </span>
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            No tools found
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : "Create a custom tool to extend your workflows."}
          </p>
          {!searchQuery && (
            <Button
              onClick={handleCreate}
              className="mt-4 h-9 rounded-md px-4 shadow-none hover:scale-100"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Tool
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTools.map((tool, i) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              index={i}
              onToggle={(e) => handleToggle(tool, e)}
              onEdit={(e) => {
                e.stopPropagation();
                handleEdit(tool);
              }}
              onDelete={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(tool.id);
              }}
              onView={() => handleViewTool(tool)}
              isUsedInAgent={isToolUsedInAgent(tool)}
            />
          ))}
        </div>
      )}

      {/* Tool Detail View Dialog */}
      <ToolDetailDialog
        isOpen={isViewDialogOpen}
        onClose={() => setIsViewDialogOpen(false)}
        tool={selectedTool}
        onToggle={async (t) => {
          await toggleToolMutation.mutateAsync({
            id: t.id,
            enabled: !t.enabled,
          });
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={deleteToolMutation.isPending}
        title="Delete Tool"
        description="Are you sure you want to delete this custom tool? This action cannot be undone."
        dialogClassName="border border-card-border"
      />
    </ContentLayout>
  );
}
