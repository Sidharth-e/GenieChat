"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Brain, AlertCircle, List, Network } from "lucide-react";
import {
  useMemories,
  useDeleteMemory,
  useCreateMemory,
  useUpdateMemory,
} from "@/hooks/use-memories-queries";
import { useChatSettings } from "@/lib/stores";
import { Memory } from "@/lib/types";
import { MemoryCard } from "@/components/memories/memory-card";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { MemoryForm } from "@/components/memories/memory-form";
import { MemoryGraph } from "@/components/memories/memory-graph";
import { AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

import { ContentLayout } from "@/components/common/content-layout";

interface MemoriesContentProps {
  initialMemories?: Memory[];
}

type MemoriesView = "list" | "graph";

const VIEWS: { id: MemoriesView; label: string; icon: typeof List }[] = [
  { id: "list", label: "List", icon: List },
  { id: "graph", label: "Graph", icon: Network },
];

export function MemoriesContent({ initialMemories }: MemoriesContentProps) {
  const {
    data: memories = initialMemories ?? [],
    isLoading,
    error,
  } = useMemories(initialMemories);
  const { memoryEnabled, setMemoryEnabled } = useChatSettings();
  const deleteMemoryMutation = useDeleteMemory();
  const createMemoryMutation = useCreateMemory();
  const updateMemoryMutation = useUpdateMemory();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [view, setView] = React.useState<MemoriesView>("list");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [editingMemory, setEditingMemory] = React.useState<Memory | null>(null);

  const filteredMemories = memories.filter((memory) => {
    const query = searchQuery.toLowerCase();
    return memory.content?.toLowerCase().includes(query);
  });

  const handleCreate = async (content: string) => {
    await createMemoryMutation.mutateAsync({ content });
    setIsCreating(false);
  };

  const handleUpdate = async (content: string) => {
    if (!editingMemory) return;

    await updateMemoryMutation.mutateAsync({
      id: editingMemory.id,
      updates: { content },
    });
    setEditingMemory(null);
  };

  const handleDelete = async (id: string) => {
    await deleteMemoryMutation.mutateAsync(id);
    setShowDeleteConfirm(null);
  };

  const handleFormClose = () => {
    setIsCreating(false);
    setEditingMemory(null);
  };

  return (
    <ContentLayout
      title="Long-Term Memory"
      description="Personal, professional, and preference details remembered across conversations (Graph-RAG retrieval is used in chat)"
      searchPlaceholder="Search memories..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      navigation={
        <div className="flex gap-4">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm transition-colors",
                view === id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-text-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      }
      actionButton={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant={memoryEnabled ? "secondary" : "outline"}
            aria-pressed={memoryEnabled}
            title={
              memoryEnabled
                ? "Disable memory in chats"
                : "Enable memory in chats"
            }
            className="h-10 shrink-0 rounded-md px-3 shadow-none hover:scale-100"
            onClick={() => setMemoryEnabled(!memoryEnabled)}
          >
            <Brain className="mr-2 h-4 w-4" />
            {memoryEnabled ? "Memory On" : "Memory Off"}
          </Button>
          <Button
            onClick={() => {
              setEditingMemory(null);
              setIsCreating(true);
            }}
            className="h-10 shrink-0 rounded-md px-4 shadow-none hover:scale-100"
          >
            New Memory
            <Plus className="ml-2 h-4 w-4" />
          </Button>
        </div>
      }
    >
      {/* Inline Create Form */}
      <AnimatePresence>
        <MemoryForm
          isOpen={isCreating || !!editingMemory}
          onClose={handleFormClose}
          onSave={editingMemory ? handleUpdate : handleCreate}
          isSaving={
            createMemoryMutation.isPending || updateMemoryMutation.isPending
          }
          mode={editingMemory ? "edit" : "create"}
          initialContent={editingMemory?.content}
        />
      </AnimatePresence>

      {/* The graph reads its own query and handles its own empty states: the
          list's "no memories found" copy is about rows, not about the drawing. */}
      {view === "graph" ? (
        <MemoryGraph searchQuery={searchQuery} />
      ) : isLoading && memories.length === 0 ? (
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
        <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--red-border)] bg-[var(--red-bg)] p-3 text-sm text-[var(--red)]">
          <AlertCircle className="h-4 w-4" />
          <span>
            {error instanceof Error ? error.message : "Failed to load memories"}
          </span>
        </div>
      ) : filteredMemories.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            No memories found
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : "Add personal, professional, and preference details for the AI to remember"}
          </p>
          {!searchQuery && (
            <Button
              onClick={() => {
                setEditingMemory(null);
                setIsCreating(true);
              }}
              className="mt-4 h-9 rounded-md px-4 shadow-none hover:scale-100"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Memory
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMemories.map((memory, i) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              index={i}
              onEdit={(e) => {
                e.stopPropagation();
                setIsCreating(false);
                setEditingMemory(memory);
              }}
              onDelete={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(memory.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={deleteMemoryMutation.isPending}
        title="Delete Memory"
        description="Are you sure you want to delete this memory? This action cannot be undone."
        dialogClassName="border border-card-border"
      />
    </ContentLayout>

  );
}
