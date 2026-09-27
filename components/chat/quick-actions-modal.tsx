"use client";

import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  Plus,
  Trash2,
  Zap,
  MessageSquare,
  Bot,
  Loader2,
  Pencil,
  Play,
  ArrowLeft,
  Sparkles,
  Pin,
  PinOff,
  BookOpen,
  Search,
  PenLine,
  Check,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useQuickActionsStore } from "@/lib/stores";
import { useQuickActionsHandler } from "@/lib/hooks/use-quick-actions-handler";
import { Agent, Prompt, QuickAction } from "@/lib/types";
import { useAuthStore } from "@/lib/auth";

interface QuickActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickActionsModal({ isOpen, onClose }: QuickActionsModalProps) {
  const { user } = useAuthStore();
  const { quickActions, addQuickAction, removeQuickAction, updateQuickAction } =
    useQuickActionsStore();
  const { executeQuickAction, executingActionId } = useQuickActionsHandler();

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [medium, setMedium] = useState<"chat" | "agent">("chat");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [promptMode, setPromptMode] = useState<"write" | "library">("write");
  const [savedPrompts, setSavedPrompts] = useState<Prompt[]>([]);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");

  const isFormValid =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (medium === "chat" || selectedAgentId.length > 0);

  useEffect(() => {
    async function fetchAgents() {
      setIsLoadingAgents(true);
      try {
        const response = await fetch("/api/agents");
        if (response.ok) {
          const data = await response.json();
          setAgents(data);
          if (data.length > 0 && !selectedAgentId) {
            setSelectedAgentId(data[0].id);
          }
        }
      } catch (error) {
        logger.error("Failed to fetch agents", error);
      } finally {
        setIsLoadingAgents(false);
      }
    }

    if (medium === "agent" && agents.length === 0) {
      fetchAgents();
    }
  }, [medium, agents.length, selectedAgentId]);

  const handleSwitchToLibrary = async () => {
    setPromptMode("library");
    if (savedPrompts.length === 0) {
      setIsLoadingPrompts(true);
      try {
        const res = await fetch("/api/prompts");
        if (res.ok) {
          const data = await res.json();
          setSavedPrompts(data);
        }
      } catch (error) {
        logger.error("Failed to fetch prompts", error);
      } finally {
        setIsLoadingPrompts(false);
      }
    }
  };

  const handleSelectPrompt = (p: Prompt) => {
    setName(p.title);
    setPrompt(p.content);
    setPromptMode("write");
    setPromptSearch("");
  };

  const filteredPrompts = savedPrompts.filter(
    (p) =>
      p.title.toLowerCase().includes(promptSearch.toLowerCase()) ||
      p.content.toLowerCase().includes(promptSearch.toLowerCase()),
  );

  const handleCreate = () => {
    if (!name || !prompt) return;
    if (medium === "agent" && !selectedAgentId) return;

    if (editingId) {
      updateQuickAction(editingId, {
        name,
        prompt,
        medium,
        agentId: medium === "agent" ? selectedAgentId : undefined,
      });
      setEditingId(null);
    } else {
      addQuickAction({
        userId: user?.id || "",
        userName: user?.name || "",
        userEmail: user?.email || "",
        name,
        prompt,
        medium,
        agentId: medium === "agent" ? selectedAgentId : undefined,
        pinned: false,
      });
    }

    setName("");
    setPrompt("");
    setMedium("chat");
    setSelectedAgentId("");
    setIsCreating(false);
  };

  const handleEdit = (action: QuickAction, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(action.id);
    setName(action.name);
    setPrompt(action.prompt);
    setMedium(action.medium);
    if (action.agentId) setSelectedAgentId(action.agentId);
    setIsCreating(true);
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setName("");
    setPrompt("");
    setMedium("chat");
    setSelectedAgentId("");
    setPromptMode("write");
    setPromptSearch("");
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[980px] w-full h-[90vh] max-h-[90vh] overflow-hidden border border-modal-border/40 bg-modal-bg p-0 shadow-2xl sm:h-[82vh]">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-input-border/40 px-5 py-3.5">
            {isCreating ? (
              <button
                onClick={handleCancel}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 ring-1 ring-primary/20">
                <Zap className="h-3.5 w-3.5 text-primary" />
              </div>
            )}

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
                  {isCreating
                    ? editingId
                      ? "Edit Action"
                      : "New Action"
                    : "Quick Actions"}
                </h2>
                {!isCreating && (
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {quickActions.length}
                  </span>
                )}
              </div>
              {!isCreating && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                  Reusable prompts for chat and agent workflows
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {!isCreating && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.97]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              )}
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {isCreating ? (
              <div className="flex h-full flex-col">
                <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
                  {/* Left: Prompt */}
                  <div className="flex min-h-0 flex-col border-b border-input-border/40 sm:flex-1 sm:border-b-0 sm:border-r">
                    {/* Tab strip */}
                    <div className="flex shrink-0 items-center gap-5 border-b border-input-border/40 px-4">
                      <button
                        type="button"
                        onClick={() => setPromptMode("write")}
                        className={cn(
                          "-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 pt-2.5 text-[12px] font-semibold transition-colors",
                          promptMode === "write"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                        Write your own
                        {prompt.length > 0 && promptMode !== "write" && (
                          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-primary">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleSwitchToLibrary}
                        className={cn(
                          "-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 pt-2.5 text-[12px] font-semibold transition-colors",
                          promptMode === "library"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        Pick from saved
                      </button>
                    </div>

                    {/* Write panel */}
                    {promptMode === "write" && (
                      <div className="flex flex-1 flex-col gap-2.5 p-4">
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="Describe exactly what you want the AI to do. Be specific — the more detail, the better the result."
                          autoFocus
                          className="flex-1 resize-none rounded-xl border border-input-border bg-input-bg px-4 py-3 text-sm leading-relaxed text-foreground outline-none transition-all placeholder:text-muted-foreground/35 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 sm:min-h-[220px]"
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground/50">
                            Use{" "}
                            <code className="rounded bg-accent px-1 py-0.5 font-mono text-[10px]">
                              {"{topic}"}
                            </code>{" "}
                            for dynamic placeholders
                          </p>
                          <span
                            className={cn(
                              "text-[11px] tabular-nums",
                              prompt.length > 800
                                ? "text-amber-500"
                                : "text-muted-foreground/40",
                            )}
                          >
                            {prompt.length}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Library panel */}
                    {promptMode === "library" && (
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex items-center gap-2 border-b border-input-border/40 px-4 py-2.5">
                          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                          <input
                            type="text"
                            value={promptSearch}
                            onChange={(e) => setPromptSearch(e.target.value)}
                            placeholder="Search saved prompts…"
                            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/35"
                            autoFocus
                          />
                          {promptSearch && (
                            <button
                              type="button"
                              onClick={() => setPromptSearch("")}
                              className="text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {isLoadingPrompts ? (
                            <div className="flex items-center justify-center py-10">
                              <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
                            </div>
                          ) : filteredPrompts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                              <BookOpen className="mb-2 h-7 w-7 text-muted-foreground/20" />
                              <p className="text-[12px] text-muted-foreground/50">
                                {promptSearch
                                  ? "No prompts match your search"
                                  : "No saved prompts yet"}
                              </p>
                            </div>
                          ) : (
                            <div className="divide-y divide-input-border/30">
                              {filteredPrompts.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => handleSelectPrompt(p)}
                                  className="group/item flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-[13px] font-medium text-foreground">
                                      {p.title}
                                    </span>
                                    <span className="shrink-0 text-[11px] text-primary opacity-0 transition-opacity group-hover/item:opacity-100">
                                      Use this →
                                    </span>
                                  </div>
                                  <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/60">
                                    {p.content}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Name + Mode + Agent */}
                  <div className="flex flex-col gap-5 p-5 sm:w-[240px] sm:shrink-0">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Code Review"
                        className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/35 focus:border-primary/50 focus:ring-2 focus:ring-primary/12"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        Mode
                      </label>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => setMedium("chat")}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                            medium === "chat"
                              ? "border-primary/35 bg-primary/8 shadow-sm"
                              : "border-input-border bg-input-bg/60 hover:border-input-border hover:bg-input-bg",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              medium === "chat"
                                ? "bg-primary/15 text-primary"
                                : "bg-accent text-muted-foreground",
                            )}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p
                              className={cn(
                                "text-[13px] font-medium leading-tight",
                                medium === "chat"
                                  ? "text-primary"
                                  : "text-foreground",
                              )}
                            >
                              Chat
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                              Standard conversation
                            </p>
                          </div>
                        </button>

                        <button
                          onClick={() => setMedium("agent")}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                            medium === "agent"
                              ? "border-primary/30 bg-primary/8 shadow-sm"
                              : "border-input-border bg-input-bg/60 hover:border-input-border hover:bg-input-bg",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              medium === "agent"
                                ? "bg-primary/15 text-primary"
                                : "bg-accent text-muted-foreground",
                            )}
                          >
                            <Bot className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <p
                              className={cn(
                                "text-[13px] font-medium leading-tight",
                                medium === "agent"
                                  ? "text-primary"
                                  : "text-foreground",
                              )}
                            >
                              Agent
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                              Route through an agent
                            </p>
                          </div>
                        </button>
                      </div>
                    </div>

                    {medium === "agent" && (
                      <div className="animate-in fade-in slide-in-from-top-1 space-y-2 duration-200">
                        <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                          Agent
                        </label>
                        {isLoadingAgents ? (
                          <div className="flex items-center justify-center rounded-xl border border-input-border bg-input-bg py-4">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          </div>
                        ) : (
                          <Select
                            value={selectedAgentId}
                            onChange={(v) => setSelectedAgentId(v)}
                            options={agents.map((agent) => ({
                              value: agent.id,
                              label: agent.name,
                            }))}
                            placeholder="Select an agent"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Form footer */}
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-input-border/40 px-5 py-3.5">
                  <button
                    onClick={handleCancel}
                    className="rounded-xl border border-input-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!isFormValid}
                    className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35"
                  >
                    {editingId ? "Save Changes" : "Create Action"}
                  </button>
                </div>
              </div>
            ) : quickActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="relative mb-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-input-border bg-input-bg/50">
                    <Zap className="h-5 w-5 text-muted-foreground/30" />
                  </div>
                  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/20">
                    <Sparkles className="h-2.5 w-2.5 text-primary/60" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  No actions yet
                </p>
                <p className="mt-1.5 max-w-[220px] text-[12px] leading-relaxed text-muted-foreground">
                  Save reusable prompts to speed up your most common tasks.
                </p>
                <button
                  onClick={() => setIsCreating(true)}
                  className="mt-6 flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2 text-[12px] font-semibold text-primary transition-all hover:bg-primary/15"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create first action
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 p-3">
                {quickActions.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    isExecuting={executingActionId === action.id}
                    isAnyExecuting={!!executingActionId}
                    onExecute={() => executeQuickAction(action)}
                    onEdit={(e) => handleEdit(action, e)}
                    onDelete={() => removeQuickAction(action.id)}
                    onTogglePin={() =>
                      updateQuickAction(action.id, { pinned: !action.pinned })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ActionCardProps {
  action: QuickAction;
  isExecuting: boolean;
  isAnyExecuting: boolean;
  onExecute: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onTogglePin: () => void;
}

function ActionCard({
  action,
  isExecuting,
  isAnyExecuting,
  onExecute,
  onEdit,
  onDelete,
  onTogglePin,
}: ActionCardProps) {
  const isChat = action.medium === "chat";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border transition-all duration-150",
        isAnyExecuting && !isExecuting
          ? "border-input-border/30 opacity-50"
          : "border-input-border/60 hover:border-input-border bg-input-bg/30 hover:bg-input-bg/60",
      )}
    >
      {/* Left accent bar */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          isChat ? "bg-primary/60" : "bg-primary/40",
        )}
      />

      <div className="flex items-center gap-3 py-3 pl-5 pr-3">
        {/* Type icon */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isChat
              ? "bg-primary/10 text-primary"
              : "bg-primary/10 text-primary",
          )}
        >
          {isChat ? (
            <MessageSquare className="h-3.5 w-3.5" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold leading-tight text-foreground">
              {action.name}
            </span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider",
                isChat
                  ? "bg-primary/10 text-primary/80"
                  : "bg-primary/10 text-primary/80",
              )}
            >
              {action.medium}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground/70">
            {action.prompt}
          </p>
        </div>

        {/* Action group */}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Secondary actions — visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={onEdit}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={`Edit ${action.name}`}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
              aria-label={`Delete ${action.name}`}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Divider */}
          <div className="mx-1.5 h-4 w-px bg-input-border/60" />

          {/* Pin — always visible, icon-only */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-90",
              action.pinned
                ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                : "text-muted-foreground/40 hover:bg-accent hover:text-muted-foreground",
            )}
            aria-label={action.pinned ? "Unpin from home" : "Pin to home"}
            title={action.pinned ? "Unpin from home" : "Pin to home"}
          >
            {action.pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Run — always visible, primary */}
          <button
            onClick={onExecute}
            disabled={isAnyExecuting}
            className={cn(
              "ml-1 flex h-7 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all",
              "bg-primary/12 text-primary hover:bg-primary/20 active:scale-95",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
            aria-label={`Run ${action.name}`}
          >
            {isExecuting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run
          </button>
        </div>
      </div>

      {/* Execution overlay */}
      {isExecuting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/50 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-lg border border-input-border/60 bg-background/90 px-3 py-1.5 shadow-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-[12px] font-medium">Running…</span>
          </div>
        </div>
      )}
    </div>
  );
}
