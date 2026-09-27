"use client";

import * as React from "react";
import { ModelConfig, ProviderKey } from "@/lib/types";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { ChevronDown, Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_NAME } from "@/constants/main";
import { GoogleIcon, OllamaIcon } from "../common/custom-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  showModelName?: boolean;
  menuAlignOffset?: number;
  shiftSubmenuLeftOnHome?: boolean;
}

interface ProviderInfo {
  id: ProviderKey;
  name: string;
  icon: React.ReactNode;
  description: string;
}

const providers: ProviderInfo[] = [
  {
    id: "google",
    name: "Google",
    icon: <GoogleIcon className="h-4 w-4" />,
    description: "Gemini models",
  },
  {
    id: "ollama",
    name: "Ollama",
    icon: <OllamaIcon className="h-4 w-4" />,
    description: "Self-hosted & cloud models",
  },
];

const providerIcons: Record<string, React.ReactNode> = {
  google: <GoogleIcon className="h-3.5 w-3.5" />,
  ollama: <OllamaIcon className="h-3.5 w-3.5" />,
};

export function ModelSelector({
  value,
  onChange,
  disabled,
  className,
  triggerClassName,
  showModelName = true,
  menuAlignOffset = 0,
  shiftSubmenuLeftOnHome = false,
}: ModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [models, setModels] = React.useState<ModelConfig[]>(AVAILABLE_MODELS);
  const [activeProvider, setActiveProvider] =
    React.useState<ProviderKey | null>(null);

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
        // Keep static fallback model list if fetch fails
      }
    };

    void fetchConfiguredModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = models.find((m) => m.id === value);
  const providersWithModels = providers.filter((provider) =>
    models.some((m) => m.provider === provider.id),
  );
  const resolvedActiveProvider =
    activeProvider ??
    selectedModel?.provider ??
    providersWithModels[0]?.id ??
    null;
  const activeProviderInfo = providers.find(
    (provider) => provider.id === resolvedActiveProvider,
  );
  const activeProviderModels = resolvedActiveProvider
    ? models.filter((m) => m.provider === resolvedActiveProvider)
    : [];
  const subMenuSide: "left" | "right" = shiftSubmenuLeftOnHome
    ? "left"
    : "right";

  const handleModelSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setActiveProvider(
              selectedModel?.provider ?? providersWithModels[0]?.id ?? null,
            );
          }
        }}
      >
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 cursor-pointer",
              "text-[11px] font-medium text-tertiary",
              "border border-tertiary/10 bg-tertiary/5",
              "hover:bg-tertiary/10 hover:text-foreground",
              "transition-all duration-200",
              "focus:outline-none focus:ring-2 focus:ring-primary/10",
              disabled && "opacity-50 cursor-not-allowed",
              triggerClassName,
            )}
          >
            {showModelName && (
              <>
                <div className="flex items-center justify-center">
                  {selectedModel ? (
                    providerIcons[selectedModel.provider]
                  ) : (
                    <GoogleIcon className="h-3 w-3" />
                  )}
                </div>
                <span className="truncate max-w-[120px] hidden sm:inline">
                  {selectedModel?.name || AI_NAME}
                </span>
              </>
            )}
            {!showModelName && (
              <div className="flex items-center justify-center">
                {selectedModel ? (
                  providerIcons[selectedModel.provider]
                ) : (
                  <GoogleIcon className="h-3 w-3" />
                )}
              </div>
            )}
            <ChevronDown
              className={cn(
                "h-3 w-3 text-tertiary/50 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          alignOffset={menuAlignOffset}
          className="relative overflow-visible w-64 bg-dropdown-bg border-tertiary/8 rounded-2xl shadow-xl z-50 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <DropdownMenuLabel className="text-[10px] text-tertiary/50 uppercase tracking-wider px-3 py-2">
            Select Model
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-tertiary/10 mx-1 mb-1" />

          <div className="max-h-[210px] overflow-y-auto overflow-x-hidden p-1.5 space-y-1">
            {providersWithModels.map((provider) => {
              const providerModels = models.filter(
                (m) => m.provider === provider.id,
              );
              const isCurrentProvider = selectedModel?.provider === provider.id;
              const isActiveProvider = resolvedActiveProvider === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onMouseEnter={() => setActiveProvider(provider.id)}
                  onFocus={() => setActiveProvider(provider.id)}
                  onClick={() => setActiveProvider(provider.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer text-left",
                    "hover:bg-tertiary/5 focus:bg-tertiary/5 rounded-lg transition-colors",
                    (isCurrentProvider || isActiveProvider) && "bg-tertiary/5",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-center w-7 h-7 rounded-md shrink-0",
                      "bg-tertiary/10 transition-colors",
                    )}
                  >
                    {provider.icon}
                  </div>
                  <div className="flex-1 flex flex-col justify-center min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground leading-none">
                        {provider.name}
                      </span>
                      {isCurrentProvider && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary leading-none">
                          Active
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-tertiary/60 leading-none mt-1.5">
                      {providerModels.length}{" "}
                      {providerModels.length === 1 ? "model" : "models"}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-tertiary/60 shrink-0" />
                </button>
              );
            })}
          </div>
          {activeProviderInfo && activeProviderModels.length > 0 && (
            <div
              className={cn(
                "rounded-xl border-tertiary/8 bg-dropdown-bg p-1.5",
                "max-sm:relative max-sm:w-full max-sm:mt-1 max-sm:border-t max-sm:pt-1.5",
                "sm:absolute sm:top-0 sm:z-60 sm:w-[180px] sm:border sm:shadow-xl",
                subMenuSide === "left"
                  ? "sm:right-[calc(100%+6px)]"
                  : "sm:left-[calc(100%+6px)]",
              )}
            >
              <DropdownMenuLabel className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-tertiary/50">
                <span className="opacity-70">{activeProviderInfo.icon}</span>
                {activeProviderInfo.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="mx-1 mb-1 bg-tertiary/10" />
              <div className="max-h-[220px] space-y-0.5 overflow-y-auto overflow-x-hidden">
                {activeProviderModels.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onSelect={() => handleModelSelect(model.id)}
                    className={cn(
                      "cursor-pointer rounded-lg px-2.5 py-2 transition-colors hover:bg-tertiary/5 focus:bg-tertiary/5",
                      value === model.id ? "bg-tertiary/5" : "",
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <span className="text-xs font-medium leading-none text-foreground">
                        {model.name}
                      </span>
                    </div>
                    {value === model.id && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </div>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
