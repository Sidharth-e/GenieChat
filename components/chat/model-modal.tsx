"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  X,
  Check,
  Brain,
  Wrench,
  Zap,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { GoogleIcon, OllamaIcon, OpenRouterIcon } from "@/components/common/custom-icons";
import { useModels } from "@/hooks/use-models-queries";
import { cn } from "@/lib/utils";
import { ProviderKey } from "@/lib/types";

export interface ModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelId?: string;
  onSelectModel: (modelId: string) => void;
  animationOrigin?: { x: number; y: number } | null;
}

type ProviderFilter = "all" | ProviderKey;
type CapabilityFilter = "all" | "reasoning" | "tools";

const providerIcons: Record<string, React.ReactNode> = {
  google: <GoogleIcon className="h-3.5 w-3.5" />,
  ollama: <OllamaIcon className="h-3.5 w-3.5" />,
  openrouter: <OpenRouterIcon className="h-3.5 w-3.5" />,
};

function formatTokens(num: number): string {
  if (num >= 1000) {
    const k = num / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k out`;
  }
  return `${num} out`;
}

function formatContext(num: number): string {
  if (num >= 1000) {
    const k = Math.round(num / 1000);
    return `${k}k chars`;
  }
  return `${num} chars`;
}

export function ModelModal({
  open,
  onOpenChange,
  selectedModelId,
  onSelectModel,
  animationOrigin,
}: ModelModalProps) {
  const { data: models = [] } = useModels();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [providerFilter, setProviderFilter] =
    React.useState<ProviderFilter>("all");
  const [capabilityFilter, setCapabilityFilter] =
    React.useState<CapabilityFilter>("all");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (open) {
      setSearchQuery("");
      setProviderFilter("all");
      setCapabilityFilter("all");
    }
  }, [open]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  const filteredModels = React.useMemo(() => {
    return models.filter((model) => {
      if (providerFilter !== "all" && model.provider !== providerFilter) {
        return false;
      }
      if (capabilityFilter === "reasoning" && !model.supportReasoning) {
        return false;
      }
      if (capabilityFilter === "tools" && !model.supportsTools) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = model.name.toLowerCase().includes(query);
        const matchesId = model.id.toLowerCase().includes(query);
        const matchesDesc = model.description.toLowerCase().includes(query);
        const matchesProvider = model.provider.toLowerCase().includes(query);
        return matchesName || matchesId || matchesDesc || matchesProvider;
      }
      return true;
    });
  }, [models, providerFilter, capabilityFilter, searchQuery]);

  const googleCount = React.useMemo(
    () => models.filter((m) => m.provider === "google").length,
    [models],
  );
  const ollamaCount = React.useMemo(
    () => models.filter((m) => m.provider === "ollama").length,
    [models],
  );
  const openrouterCount = React.useMemo(
    () => models.filter((m) => m.provider === "openrouter").length,
    [models],
  );

  const handleSelect = (modelId: string) => {
    onSelectModel(modelId);
    onOpenChange(false);
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="model-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-99 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="fixed inset-0 z-100 flex items-center justify-center p-3 sm:p-6 pointer-events-none">
            <motion.div
              key="model-modal-container"
              initial={{
                opacity: 0,
                scale: 0.85,
                x: animationOrigin?.x ?? 0,
                y: animationOrigin?.y ?? 20,
              }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{
                opacity: 0,
                scale: 0.85,
                x: animationOrigin?.x ?? 0,
                y: animationOrigin?.y ?? 20,
              }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto w-full sm:max-w-4xl h-[85vh] max-h-[85vh] min-h-[500px] flex flex-col rounded-2xl border border-modal-border/40 bg-modal-bg text-foreground overflow-hidden shadow-2xl"
            >
              <div className="flex flex-col h-full min-h-0">
                <DialogHeader className="p-4 sm:p-5 border-b border-card-border/60 shrink-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-card-border bg-secondary/60">
                        <Sparkles className="h-5 w-5 text-foreground/80" />
                      </div>
                      <div className="space-y-0.5 text-left">
                        <DialogTitle className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
                          Select AI Model
                        </DialogTitle>
                        <DialogDescription className="text-xs text-text-secondary">
                          Choose an AI model for your conversations and
                          autonomous tasks.
                        </DialogDescription>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
                        <Input
                          placeholder="Search models..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-9 border-card-border bg-card-bg pl-8 text-xs shadow-none"
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground cursor-pointer"
                        aria-label="Close model modal"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      <button
                        type="button"
                        onClick={() => setProviderFilter("all")}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border",
                          providerFilter === "all"
                            ? "bg-primary text-background border-primary"
                            : "bg-tertiary/5 text-tertiary/70 border-tertiary/10 hover:bg-tertiary/10 hover:text-foreground",
                        )}
                      >
                        All ({models.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setProviderFilter("google")}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border",
                          providerFilter === "google"
                            ? "bg-primary text-background border-primary"
                            : "bg-tertiary/5 text-tertiary/70 border-tertiary/10 hover:bg-tertiary/10 hover:text-foreground",
                        )}
                      >
                        <GoogleIcon className="h-3.5 w-3.5" />
                        Google ({googleCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setProviderFilter("ollama")}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border",
                          providerFilter === "ollama"
                            ? "bg-primary text-background border-primary"
                            : "bg-tertiary/5 text-tertiary/70 border-tertiary/10 hover:bg-tertiary/10 hover:text-foreground",
                        )}
                      >
                        <OllamaIcon className="h-3.5 w-3.5" />
                        Ollama ({ollamaCount})
                      </button>
                      {openrouterCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setProviderFilter("openrouter")}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer border",
                            providerFilter === "openrouter"
                              ? "bg-primary text-background border-primary"
                              : "bg-tertiary/5 text-tertiary/70 border-tertiary/10 hover:bg-tertiary/10 hover:text-foreground",
                          )}
                        >
                          <OpenRouterIcon className="h-3.5 w-3.5" />
                          OpenRouter ({openrouterCount})
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-tertiary/50 mr-1 flex items-center gap-1">
                        <SlidersHorizontal className="h-3 w-3" />
                        Feature:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCapabilityFilter((prev) =>
                            prev === "reasoning" ? "all" : "reasoning",
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
                          capabilityFilter === "reasoning"
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "bg-card-bg text-tertiary/60 border-card-border hover:bg-hover-bg hover:text-foreground",
                        )}
                      >
                        <Brain className="h-3 w-3" />
                        Reasoning
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCapabilityFilter((prev) =>
                            prev === "tools" ? "all" : "tools",
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer border",
                          capabilityFilter === "tools"
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "bg-card-bg text-tertiary/60 border-card-border hover:bg-hover-bg hover:text-foreground",
                        )}
                      >
                        <Wrench className="h-3 w-3" />
                        Tools
                      </button>
                    </div>
                  </div>
                </DialogHeader>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
                  {filteredModels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="rounded-full bg-tertiary/5 p-4 mb-3 border border-card-border">
                        <Search className="h-6 w-6 text-tertiary/40" />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">
                        No models found
                      </h4>
                      <p className="text-xs text-text-secondary mt-1 max-w-sm">
                        No models match your current search and filter criteria.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearchQuery("");
                          setProviderFilter("all");
                          setCapabilityFilter("all");
                        }}
                        className="mt-3 text-xs text-primary hover:bg-primary/10"
                      >
                        Reset filters
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredModels.map((model) => {
                        const isSelected = model.id === selectedModelId;
                        return (
                          <div
                            key={model.id}
                            onClick={() => handleSelect(model.id)}
                            className={cn(
                              "group relative flex flex-col justify-between p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-200 h-full min-h-[140px]",
                              isSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm"
                                : "border-card-border bg-card-bg hover:border-tertiary/30 hover:bg-hover-bg",
                            )}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-tertiary/70">
                                  {providerIcons[model.provider]}
                                  <span className="capitalize">
                                    {model.provider}
                                  </span>
                                </div>
                                {isSelected ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary text-background shrink-0">
                                    <Check className="h-3 w-3" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-tertiary/40 group-hover:text-primary transition-colors shrink-0">
                                    Select
                                  </span>
                                )}
                              </div>

                              <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors mt-2 leading-tight">
                                {model.name}
                              </h3>
                              <p className="text-xs text-text-secondary line-clamp-2 mt-1.5 leading-relaxed">
                                {model.description}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 pt-3 mt-3 border-t border-card-border/50">
                              {model.supportReasoning && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-tertiary/5 text-tertiary/80 border border-tertiary/10">
                                  <Brain className="h-2.5 w-2.5 text-primary" />
                                  Reasoning
                                </span>
                              )}
                              {model.supportsTools && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-tertiary/5 text-tertiary/80 border border-tertiary/10">
                                  <Wrench className="h-2.5 w-2.5 text-primary" />
                                  Tools
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-tertiary/5 text-tertiary/60 border border-tertiary/10">
                                <Zap className="h-2.5 w-2.5" />
                                {formatTokens(model.maxOutput)}
                              </span>
                              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-tertiary/5 text-tertiary/50 border border-tertiary/10 ml-auto">
                                {formatContext(model.maxInputChars)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between px-5 py-3 border-t border-card-border/60 bg-secondary/30 text-xs text-text-secondary shrink-0">
                  <div>
                    {selectedModel ? (
                      <span>
                        Currently active:{" "}
                        <strong className="text-foreground font-medium">
                          {selectedModel.name}
                        </strong>
                      </span>
                    ) : (
                      <span>Select a model to use for this chat</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    className="h-7 text-xs text-tertiary/70 hover:text-foreground cursor-pointer"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
