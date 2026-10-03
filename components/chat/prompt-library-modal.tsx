"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, LayoutGroup, AnimatePresence } from "framer-motion";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, FileText, X, Plus } from "lucide-react";
import { PromptCard } from "@/components/prompts/prompt-card";
import {
  PromptEditor,
  type PromptEditorData,
} from "@/components/prompts/prompt-editor";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import {
  usePrompts,
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  useToggleFavoritePrompt,
} from "@/hooks/use-prompts-queries";
import { Prompt } from "@/lib/types";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

interface PromptLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: string) => void;
  animationOrigin?: { x: number; y: number } | null;
}

type PromptTab = "favorites" | "discover";

type EditorState = { mode: "create" } | { mode: "edit"; prompt: Prompt };

export function PromptLibraryModal({
  open,
  onOpenChange,
  onSelect,
  animationOrigin,
}: PromptLibraryModalProps) {
  const { data: prompts = [], isLoading } = usePrompts();
  const createPromptMutation = useCreatePrompt();
  const updatePromptMutation = useUpdatePrompt();
  const deletePromptMutation = useDeletePrompt();
  const favoritePromptMutation = useToggleFavoritePrompt();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<PromptTab>("discover");
  const [selectedPromptId, setSelectedPromptId] = React.useState<string | null>(
    null,
  );
  const [editedContent, setEditedContent] = React.useState("");
  const [templateContent, setTemplateContent] = React.useState("");
  const [variableValues, setVariableValues] = React.useState<
    Record<string, string>
  >({});
  const [isManualEdit, setIsManualEdit] = React.useState(false);
  const [editorState, setEditorState] = React.useState<EditorState | null>(
    null,
  );
  const [editorError, setEditorError] = React.useState<string | null>(null);
  const [promptToDelete, setPromptToDelete] = React.useState<Prompt | null>(
    null,
  );

  const tabFilteredPrompts = prompts.filter((prompt) => {
    if (activeTab === "favorites") return !!prompt.isFavorite;
    return true;
  });

  const filteredPrompts = tabFilteredPrompts.filter(
    (prompt) =>
      prompt.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
  );

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);

  React.useEffect(() => {
    if (open) {
      setSelectedPromptId(null);
      setSearchQuery("");
      setActiveTab("discover");
      setEditedContent("");
      setTemplateContent("");
      setVariableValues({});
      setIsManualEdit(false);
      setEditorState(null);
      setEditorError(null);
      setPromptToDelete(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!selectedPromptId) return;
    const isVisible = filteredPrompts.some(
      (prompt) => prompt.id === selectedPromptId,
    );
    if (!isVisible) {
      setSelectedPromptId(null);
    }
  }, [filteredPrompts, selectedPromptId]);

  const extractVariables = (content: string) => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return Array.from(new Set(matches.map((m) => m[1])));
  };

  const variables = React.useMemo(
    () => extractVariables(templateContent),
    [templateContent],
  );

  React.useEffect(() => {
    if (selectedPrompt) {
      setTemplateContent(selectedPrompt.content);
      setEditedContent(selectedPrompt.content);
      setVariableValues({});
      setIsManualEdit(false);
    }
  }, [selectedPrompt]);

  React.useEffect(() => {
    if (isManualEdit) return;

    let newContent = templateContent;
    variables.forEach((variable) => {
      const value = variableValues[variable] || `{{${variable}}}`;
      newContent = newContent.replace(
        new RegExp(`\\{\\{${variable}\\}\\}`, "g"),
        value,
      );
    });
    setEditedContent(newContent);
  }, [templateContent, variableValues, variables, isManualEdit]);

  const handleSelectPrompt = () => {
    if (selectedPrompt) {
      onSelect(editedContent);
      onOpenChange(false);
    }
  };

  // --- Create / edit / delete ---

  const handleStartCreate = () => {
    setSelectedPromptId(null);
    setEditorError(null);
    setEditorState({ mode: "create" });
  };

  const handleStartEdit = (prompt: Prompt) => {
    setSelectedPromptId(null);
    setEditorError(null);
    setEditorState({ mode: "edit", prompt });
  };

  const handleCancelEditor = () => {
    setEditorState(null);
    setEditorError(null);
  };

  const handleSavePrompt = async (data: PromptEditorData) => {
    if (!editorState) return;

    setEditorError(null);
    try {
      if (editorState.mode === "create") {
        const created = await createPromptMutation.mutateAsync(data);
        // The editor covers the list, so returning to it under the current
        // filters could land on "No prompts found" — clear them so the prompt
        // just created is actually there to be selected.
        setActiveTab("discover");
        setSearchQuery("");
        setSelectedPromptId(created.id);
      } else {
        await updatePromptMutation.mutateAsync({
          id: editorState.prompt.id,
          updates: data,
        });
        setSelectedPromptId(editorState.prompt.id);
      }
      setEditorState(null);
    } catch (error) {
      logger.error({ error }, "Failed to save prompt");
      setEditorError("Could not save the prompt. Please try again.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!promptToDelete) return;

    const deletedId = promptToDelete.id;
    try {
      await deletePromptMutation.mutateAsync(deletedId);
      if (selectedPromptId === deletedId) setSelectedPromptId(null);
      if (editorState?.mode === "edit" && editorState.prompt.id === deletedId) {
        setEditorState(null);
      }
      setPromptToDelete(null);
    } catch (error) {
      logger.error({ error }, "Failed to delete prompt");
    }
  };

  // --- Card actions ---

  const handleToggleFavorite = (prompt: Prompt, e: React.MouseEvent) => {
    e.stopPropagation();
    favoritePromptMutation.mutate({
      promptId: prompt.id,
      favorite: !prompt.isFavorite,
    });
  };

  const handleCopyContent = (prompt: Prompt, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(prompt.content).catch((error) => {
      logger.error({ error }, "Failed to copy prompt content");
    });
  };

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (promptToDelete) {
        setPromptToDelete(null);
        return;
      }
      // Escape unwinds one layer at a time — closing the whole library from
      // inside the editor would silently discard whatever was typed.
      if (editorState) {
        setEditorState(null);
        setEditorError(null);
        return;
      }
      onOpenChange(false);
    };
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange, promptToDelete, editorState]);

  const favoriteCount = prompts.filter((prompt) => !!prompt.isFavorite).length;
  const tabs: { key: PromptTab; label: string; count?: number }[] = [
    { key: "favorites", label: "Favorites", count: favoriteCount },
    { key: "discover", label: "Discover" },
  ];

  const isPaneOpen = !!selectedPrompt;
  const isSavingPrompt =
    createPromptMutation.isPending || updatePromptMutation.isPending;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-99 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="modal"
              initial={{
                opacity: 0,
                scale: 0.15,
                x: animationOrigin?.x ?? 0,
                y: animationOrigin?.y ?? 20,
              }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{
                opacity: 0,
                scale: 0.15,
                x: animationOrigin?.x ?? 0,
                y: animationOrigin?.y ?? 20,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              style={{ borderRadius: "0.5rem" }}
              className="pointer-events-auto w-full sm:max-w-[980px] h-[90vh] max-h-[90vh] flex flex-col border border-modal-border/40 bg-modal-bg text-foreground overflow-hidden shadow-2xl"
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col h-full min-h-0"
              >
                {editorState && (
                  <PromptEditor
                    key={
                      editorState.mode === "edit"
                        ? `${editorState.prompt.id}:${editorState.prompt.updatedAt}`
                        : "new"
                    }
                    initialData={
                      editorState.mode === "edit" ? editorState.prompt : null
                    }
                    onSave={handleSavePrompt}
                    onCancel={handleCancelEditor}
                    onClose={() => onOpenChange(false)}
                    isSaving={isSavingPrompt}
                    error={editorError}
                  />
                )}

                {!editorState && (
                <DialogHeader className="p-5 mb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-card-border bg-secondary/50">
                        <FileText className="h-4 w-4 text-foreground/80" />
                      </div>
                      <div className="space-y-1">
                        <DialogTitle className="font-serif text-2xl text-foreground">
                          Prompt Library
                        </DialogTitle>
                        <DialogDescription>
                          Create, edit, and insert prompts into chat.
                        </DialogDescription>
                      </div>
                    </div>
                    <div className="flex w-full max-w-sm items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
                        <Input
                          placeholder="Search prompts..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-10 border-card-border bg-card-bg pl-9 shadow-none"
                        />
                      </div>
                      <button
                        onClick={() => onOpenChange(false)}
                        className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground"
                        aria-label="Close prompt library"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </DialogHeader>
                )}

                {!editorState && (
                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                  <div
                    className={cn(
                      "w-full min-h-0 flex flex-1 flex-col gap-4 overflow-hidden p-4 transition-all duration-200",
                      isPaneOpen && "sm:max-w-[58%]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="-mx-1 min-w-0 flex-1 overflow-x-auto hide-scrollbar px-1">
                        <LayoutGroup id="prompt-modal-tabs">
                          <div className="flex min-w-max items-center gap-6">
                            {tabs.map((tab) => (
                              <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={cn(
                                  "relative -mb-px pb-2 text-sm font-semibold transition-colors",
                                  activeTab === tab.key
                                    ? "text-primary"
                                    : "text-text-secondary hover:text-foreground",
                                )}
                              >
                                {tab.label}
                                {typeof tab.count === "number"
                                  ? ` (${tab.count})`
                                  : ""}
                                {activeTab === tab.key && (
                                  <motion.div
                                    layoutId="prompt-modal-tab-indicator"
                                    className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary"
                                    transition={{
                                      type: "spring",
                                      stiffness: 500,
                                      damping: 40,
                                    }}
                                  />
                                )}
                              </button>
                            ))}
                          </div>
                        </LayoutGroup>
                      </div>
                      <Button
                        onClick={handleStartCreate}
                        className="h-9 shrink-0 rounded-full px-4 shadow-none hover:scale-100"
                      >
                        New Prompt
                        <Plus className="ml-1.5 h-4 w-4" />
                      </Button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      {isLoading && prompts.length === 0 ? (
                        <div className="flex items-center justify-center py-10 text-text-secondary">
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          <span className="text-sm">Loading prompts...</span>
                        </div>
                      ) : filteredPrompts.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                          <FileText className="h-7 w-7 text-text-secondary/35 mb-2" />
                          <p className="text-sm font-medium text-foreground">
                            {activeTab === "favorites" && !searchQuery
                              ? "No favorites yet"
                              : "No prompts found"}
                          </p>
                          <p className="text-xs text-text-secondary mt-1">
                            {searchQuery
                              ? "Try a different search keyword."
                              : activeTab === "favorites"
                                ? "Favorite prompts will show up here."
                                : "Create a prompt to start building your library."}
                          </p>
                          {!searchQuery && activeTab === "discover" && (
                            <Button
                              onClick={handleStartCreate}
                              className="mt-4 h-9 rounded-full px-4 shadow-none hover:scale-100"
                            >
                              <Plus className="h-4 w-4" />
                              Create Prompt
                            </Button>
                          )}
                        </div>
                      ) : (
                        <LayoutGroup id="prompt-modal-cards">
                          <div className="grid grid-cols-1 gap-3 p-1 sm:grid-cols-2 lg:grid-cols-3">
                            {filteredPrompts.map((prompt, index) => (
                              <div
                                key={prompt.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedPromptId(prompt.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedPromptId(prompt.id);
                                  }
                                }}
                                className={cn(
                                  "relative cursor-pointer rounded-lg border border-transparent outline-none",
                                  "focus-visible:ring-2 focus-visible:ring-primary/50",
                                )}
                              >
                                {selectedPromptId === prompt.id && (
                                  <motion.div
                                    layoutId="prompt-card-selection"
                                    className="absolute inset-0 rounded-lg border border-primary/60 bg-primary/5"
                                    transition={{
                                      type: "spring",
                                      stiffness: 400,
                                      damping: 35,
                                    }}
                                  />
                                )}
                                <PromptCard
                                  prompt={prompt}
                                  index={index}
                                  isFavorite={!!prompt.isFavorite}
                                  onEdit={() => handleStartEdit(prompt)}
                                  onCopy={(e) => handleCopyContent(prompt, e)}
                                  onDelete={(e) => {
                                    e.stopPropagation();
                                    setPromptToDelete(prompt);
                                  }}
                                  onFavoriteToggle={(e) =>
                                    handleToggleFavorite(prompt, e)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </LayoutGroup>
                      )}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "w-full min-h-0 overflow-hidden border-card-border/50 bg-secondary/20 transition-all duration-200 ease-out sm:border-l",
                      isPaneOpen
                        ? "max-h-[66vh] border-t opacity-100 sm:w-[48%] sm:max-h-none sm:border-t-0"
                        : "pointer-events-none max-h-0 border-t-0 opacity-0 sm:w-0 sm:max-h-none sm:border-t-0 sm:opacity-0",
                    )}
                  >
                    {selectedPrompt ? (
                      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 pb-6">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                            Preview
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPromptId(null)}
                            className="h-7 px-2 text-xs text-text-secondary hover:bg-hover-bg hover:text-foreground"
                          >
                            Close
                          </Button>
                        </div>

                        <div className="rounded-xl bg-card-bg/75 p-4 shrink-0">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <h3 className="text-base font-semibold text-foreground">
                              {selectedPrompt.title}
                            </h3>
                            {!isManualEdit && variables.length > 0 && (
                              <span className="text-xs text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">
                                {variables.length} Variable
                                {variables.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {selectedPrompt.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {selectedPrompt.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full bg-hover-bg px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {!isManualEdit && variables.length > 0 && (
                          <div className="grid shrink-0 gap-3 rounded-xl bg-card-bg/75 p-3.5">
                            {variables.map((variable) => (
                              <div
                                key={variable}
                                className="flex flex-col gap-1.5"
                              >
                                <label className="text-xs font-medium text-text-secondary ml-0.5">
                                  {variable.charAt(0).toUpperCase() +
                                    variable.slice(1).replace(/_/g, " ")}
                                </label>
                                <Input
                                  value={variableValues[variable] || ""}
                                  onChange={(e) =>
                                    setVariableValues({
                                      ...variableValues,
                                      [variable]: e.target.value,
                                    })
                                  }
                                  placeholder={`Enter ${variable.replace(/_/g, " ")}...`}
                                  className="h-9 border-card-border bg-card-bg text-sm"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-card-bg/75 p-3.5">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-foreground">
                              Prompt Content
                            </label>
                            {isManualEdit && variables.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsManualEdit(false)}
                                className="h-7 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                              >
                                Reset to Template
                              </Button>
                            )}
                          </div>

                          <textarea
                            value={editedContent}
                            onChange={(e) => {
                              setEditedContent(e.target.value);
                              setIsManualEdit(true);
                            }}
                            rows={10}
                            className={cn(
                              "h-full w-full resize-none overflow-y-auto rounded-md border p-3 text-sm font-mono leading-relaxed whitespace-pre-wrap transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
                              "min-h-[220px] flex-1",
                              isManualEdit
                                ? "bg-card-bg border-card-border text-foreground"
                                : "bg-secondary/30 border-card-border text-text-secondary",
                            )}
                            placeholder="Enter prompt content..."
                          />
                        </div>
                      </div>
                    ) : (
                      <div />
                    )}
                  </div>
                </div>
                )}

                {!editorState && (
                  <div className="flex items-center justify-end gap-2 bg-modal-bg px-5 py-3">
                    <Button
                      variant="ghost"
                      onClick={() => onOpenChange(false)}
                      className="h-9 rounded-md px-4 shadow-none hover:scale-100"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSelectPrompt}
                      disabled={!selectedPrompt || !editedContent.trim()}
                      className="h-9 rounded-md px-4 shadow-none hover:scale-100"
                    >
                      Use Prompt
                    </Button>
                  </div>
                )}

                <DeleteConfirmationModal
                  isOpen={!!promptToDelete}
                  onClose={() => setPromptToDelete(null)}
                  onConfirm={handleConfirmDelete}
                  isDeleting={deletePromptMutation.isPending}
                  title="Delete Prompt"
                  description="Are you sure you want to delete this prompt? This action cannot be undone."
                  dialogClassName="border border-card-border"
                />
              </motion.div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
