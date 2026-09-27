"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AI_NAME } from "@/constants/main";
import { GoogleIcon, OllamaIcon } from "../common/custom-icons";
import { ModelModal } from "./model-modal";
import { useModels } from "@/hooks/use-models-queries";

export interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  showModelName?: boolean;
  menuAlignOffset?: number;
  shiftSubmenuLeftOnHome?: boolean;
}

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
}: ModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [origin, setOrigin] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const { data: models = [] } = useModels();

  const selectedModel = models.find((m) => m.id === value);

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setOrigin({
        x: rect.left + rect.width / 2 - window.innerWidth / 2,
        y: rect.top + rect.height / 2 - window.innerHeight / 2,
      });
    }
    setOpen(true);
  };

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          "h-7 flex items-center gap-1.5 rounded-full px-2.5 py-1 cursor-pointer",
          "text-[11px] font-medium text-tertiary",
          "border border-tertiary/10 bg-tertiary/5",
          "hover:bg-tertiary/10 hover:text-foreground",
          "transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-primary/10",
          disabled && "opacity-50 cursor-not-allowed",
          triggerClassName,
        )}
      >
        <div className="flex items-center justify-center">
          {selectedModel ? (
            providerIcons[selectedModel.provider]
          ) : (
            <GoogleIcon className="h-3 w-3" />
          )}
        </div>
        {showModelName && (
          <span className="truncate max-w-[130px] hidden sm:inline">
            {selectedModel?.name || AI_NAME}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 text-tertiary/50 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      <ModelModal
        open={open}
        onOpenChange={setOpen}
        selectedModelId={value}
        onSelectModel={onChange}
        animationOrigin={origin}
      />
    </div>
  );
}

export { ModelModal };
