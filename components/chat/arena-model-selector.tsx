"use client";

import * as React from "react";
import { ModelConfig } from "@/lib/types";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { X, Trophy, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { GoogleIcon, OllamaIcon, OpenRouterIcon } from "../common/custom-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useArenaStore } from "@/lib/stores/arena";
import { ArenaLeaderboard } from "./arena-leaderboard";

const providerIcons: Record<string, React.ReactNode> = {
  google: <GoogleIcon className="h-3 w-3" />,
  ollama: <OllamaIcon className="h-3 w-3" />,
  openrouter: <OpenRouterIcon className="h-3 w-3" />,
};

interface ArenaModelSelectorProps {
  disabled?: boolean;
  className?: string;
}

export function ArenaModelSelector({
  disabled,
  className,
}: ArenaModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = React.useState(false);
  const [models, setModels] = React.useState<ModelConfig[]>(AVAILABLE_MODELS);

  const {
    isArenaMode,
    selectedModels,
    toggleArenaMode,
    addModel,
    removeModel,
  } = useArenaStore();

  React.useEffect(() => {
    let cancelled = false;
    const fetchConfiguredModels = async () => {
      try {
        const response = await fetch("/api/models", { cache: "no-store" });
        if (!response.ok) return;
        const configuredModels = (await response.json()) as ModelConfig[];
        if (
          Array.isArray(configuredModels) &&
          configuredModels.length > 0 &&
          !cancelled
        ) {
          setModels(configuredModels);
        }
      } catch {
        // Keep static fallback
      }
    };
    void fetchConfiguredModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleModelToggle = (modelId: string) => {
    if (selectedModels.includes(modelId)) {
      removeModel(modelId);
    } else {
      addModel(modelId);
    }
  };

  if (!isArenaMode) {
    return (
      <button
        type="button"
        onClick={toggleArenaMode}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 rounded-full px-2.5 py-1 cursor-pointer",
          "text-[11px] font-medium text-tertiary/50",
          "border border-dashed border-tertiary/15",
          "hover:bg-primary/5 hover:text-primary hover:border-primary/20",
          "transition-all duration-200",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        title="Enable Arena Mode - Compare multiple models"
      >
        <Trophy className="h-3 w-3" />
        <span className="hidden sm:inline">Arena</span>
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* Selected model chips */}
      {selectedModels.map((modelId) => {
        const model = models.find((m) => m.id === modelId);
        return (
          <div
            key={modelId}
            className="flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5"
          >
            {model && providerIcons[model.provider] && (
              <span className="opacity-60">
                {providerIcons[model.provider]}
              </span>
            )}
            <span className="max-w-[60px] truncate text-[10px] font-medium text-primary">
              {model?.name || modelId}
            </span>
            <button
              type="button"
              onClick={() => removeModel(modelId)}
              className="cursor-pointer text-primary/40 hover:text-primary"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}

      {/* Add model dropdown */}
      {selectedModels.length < 3 && (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 cursor-pointer",
                "text-[10px] font-medium text-primary/60",
                "border border-dashed border-primary/20",
                "hover:bg-primary/5 hover:text-primary",
                "transition-all duration-200",
              )}
            >
              + Add
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            className="max-h-[240px] w-48 overflow-y-auto rounded-2xl border-tertiary/8 bg-dropdown-bg shadow-xl"
          >
            <DropdownMenuLabel className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-tertiary/50">
              Select Model
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="mx-1 bg-tertiary/10" />
            {models
              .filter((m) => !selectedModels.includes(m.id))
              .map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => {
                    handleModelToggle(model.id);
                    if (selectedModels.length >= 1) {
                      setOpen(false);
                    }
                  }}
                  className="cursor-pointer rounded-lg px-2.5 py-2 transition-colors hover:bg-tertiary/5 focus:bg-tertiary/5"
                >
                  <div className="flex items-center gap-2">
                    {providerIcons[model.provider] && (
                      <span className="opacity-50">
                        {providerIcons[model.provider]}
                      </span>
                    )}
                    <span className="text-xs text-foreground">
                      {model.name}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Leaderboard button */}
      <button
        type="button"
        onClick={() => setLeaderboardOpen(true)}
        className="cursor-pointer rounded-full p-1 text-tertiary/40 hover:bg-primary/5 hover:text-primary"
        title="View Leaderboard"
      >
        <BarChart3 className="h-3 w-3" />
      </button>

      {/* Exit arena button */}
      <button
        type="button"
        onClick={toggleArenaMode}
        className="cursor-pointer rounded-full p-1 text-tertiary/40 hover:bg-tertiary/5 hover:text-tertiary"
        title="Exit Arena Mode"
      >
        <X className="h-3 w-3" />
      </button>

      <ArenaLeaderboard
        open={leaderboardOpen}
        onOpenChange={setLeaderboardOpen}
      />
    </div>
  );
}
