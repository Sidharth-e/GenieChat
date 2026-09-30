"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, AlertCircle } from "lucide-react";
import {
  usePrompts,
  useDeletePrompt,
  useSharePrompt,
  useToggleFavoritePrompt,
} from "@/hooks/use-prompts-queries";
import { Prompt } from "@/lib/types";
import { PromptCard } from "@/components/prompts/prompt-card";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { ShareModal } from "@/components/share/share-modal";

import { ContentLayout } from "@/components/common/content-layout";
import { ContentFilterPills } from "@/components/common/content-filter-pills";

interface PromptsContentProps {
  initialPrompts?: Prompt[];
}

type PromptTab = "favorites" | "discover" | "public" | "custom";

export function PromptsContent({ initialPrompts }: PromptsContentProps) {
  const router = useRouter();

  // Server state from React Query
  const {
    data: prompts = initialPrompts ?? [],
    isLoading,
    error,
  } = usePrompts(initialPrompts);
  const deletePromptMutation = useDeletePrompt();
  const sharePromptMutation = useSharePrompt();
  const favoritePromptMutation = useToggleFavoritePrompt();

  // UI State
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<PromptTab>("discover");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<
    string | null
  >(null);
  const [sharingPrompt, setSharingPrompt] = React.useState<Prompt | null>(null);

  const getShareUrl = (prompt: Prompt) => {
    if (typeof window === "undefined") return "";
    if (prompt.shareId) {
      return `${window.location.origin}/share/prompts/${prompt.shareId}`;
    }
    return null;
  };

  const handleToggleShare = async (
    enable: boolean,
    shareMode?: "public" | "specific",
    sharedWith?: { id: string; displayName: string; email: string }[],
  ) => {
    if (!sharingPrompt) return;
    await sharePromptMutation.mutateAsync({
      promptId: sharingPrompt.id,
      enable,
      shareMode,
      sharedWith,
    });
    setSharingPrompt(null);
  };

  const tabFilteredPrompts = prompts.filter((prompt) => {
    if (activeTab === "favorites") return !!prompt.isFavorite;
    if (activeTab === "public") return prompt.isShared;
    if (activeTab === "custom") return !prompt.isShared;
    return true;
  });

  const filteredPrompts = tabFilteredPrompts.filter((prompt) => {
    const query = searchQuery.toLowerCase();
    return (
      prompt.title.toLowerCase().includes(query) ||
      prompt.content.toLowerCase().includes(query) ||
      prompt.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  const favoriteCount = prompts.filter((prompt) => !!prompt.isFavorite).length;

  const handleOpenCreate = () => {
    router.push("/prompts/new");
  };

  const handleOpenEdit = (prompt: Prompt, e?: React.MouseEvent) => {
    e?.stopPropagation();
    router.push(`/prompts/${prompt.id}/edit`);
  };

  const handleCopy = (content: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
  };

  const handleDelete = async (id: string) => {
    await deletePromptMutation.mutateAsync(id);
    setShowDeleteConfirm(null);
  };

  const handleToggleFavorite = (prompt: Prompt, e: React.MouseEvent) => {
    e.stopPropagation();
    favoritePromptMutation.mutate({
      promptId: prompt.id,
      favorite: !prompt.isFavorite,
    });
  };

  const tabs: { key: PromptTab; label: string; count?: number }[] = [
    { key: "favorites", label: "Favorites", count: favoriteCount },
    { key: "discover", label: "Discover" },
    { key: "public", label: "Public" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <ContentLayout
      title="Prompt Library"
      description="Templates to help you get creative without starting from scratch"
      searchPlaceholder="Search prompts..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      actionButton={
        <Button
          onClick={handleOpenCreate}
          className="h-10 rounded-md px-4 shadow-none hover:scale-100"
        >
          New Prompt
          <Plus className="ml-2 h-4 w-4" />
        </Button>
      }
      navigation={
        <ContentFilterPills
          ariaLabel="Filter prompts"
          options={tabs.map((tab) => ({
            value: tab.key,
            label: tab.label,
            count: tab.count,
          }))}
          value={activeTab}
          onChange={setActiveTab}
        />
      }
    >
      {isLoading && prompts.length === 0 ? (
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
            {error instanceof Error ? error.message : "Failed to load prompts"}
          </span>
        </div>
      ) : filteredPrompts.length === 0 ? (
        <div className="rounded-md border border-dashed border-card-border bg-card-bg p-10 text-center">
          <h3 className="text-base font-semibold text-foreground">
            {activeTab === "favorites" && !searchQuery
              ? "No favorites yet"
              : "No prompts found"}
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery
              ? "Try a different search keyword."
              : activeTab === "favorites"
                ? "Click the heart icon on any prompt to add it to Favorites."
                : "Create a new prompt to start building your library."}
          </p>
          {!searchQuery && (
            <Button
              onClick={handleOpenCreate}
              className="mt-4 h-9 rounded-md px-4 shadow-none hover:scale-100"
            >
              <Plus className="h-4 w-4" />
              Create Prompt
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPrompts.map((prompt, i) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              index={i}
              isFavorite={!!prompt.isFavorite}
              onFavoriteToggle={(e) => handleToggleFavorite(prompt, e)}
              onEdit={(e) => handleOpenEdit(prompt, e)}
              onCopy={(e) => handleCopy(prompt.content, e)}
              onDelete={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(prompt.id);
              }}
              onShare={(e) => {
                e.stopPropagation();
                setSharingPrompt(prompt);
              }}
            />
          ))}
        </div>
      )}

      <DeleteConfirmationModal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        isDeleting={deletePromptMutation.isPending}
        title="Delete Prompt"
        description="Are you sure you want to delete this prompt? This action cannot be undone."
        dialogClassName="border border-card-border"
      />

      {(() => {
        if (!sharingPrompt) return null;
        const latestPrompt =
          prompts.find((prompt) => prompt.id === sharingPrompt.id) ||
          sharingPrompt;
        return (
          <ShareModal
            isOpen={true}
            onClose={() => setSharingPrompt(null)}
            isShared={latestPrompt.isShared}
            shareUrl={getShareUrl(latestPrompt)}
            shareMode={latestPrompt.shareMode}
            sharedWith={latestPrompt.sharedWith}
            allowPublic={false}
            onToggleShare={handleToggleShare}
          />
        );
      })()}
    </ContentLayout>
  );
}
