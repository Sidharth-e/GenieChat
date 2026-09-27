"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Brain, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReasoningEffort } from "@/lib/types";

interface ReasoningMenuProps {
  reasoningEffort: ReasoningEffort;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function ReasoningMenu({
  reasoningEffort,
  onReasoningEffortChange,
  disabled = false,
}: ReasoningMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const isActive = reasoningEffort !== "off";

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (effort: ReasoningEffort) => {
    onReasoningEffortChange(effort);
    setIsOpen(false);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReasoningEffortChange("off");
  };

  const activeLabel =
    EFFORT_OPTIONS.find((o) => o.value === reasoningEffort)?.label ?? "";

  return (
    <div className="relative flex items-center" ref={menuRef}>
      {isActive ? (
        <div
          className={cn(
            "flex items-center gap-1 sm:gap-1.5 h-8 pl-2 sm:pl-2.5 pr-1.5 rounded-full cursor-pointer",
            "bg-primary/10 border border-primary/20",
            "text-primary text-sm font-medium",
            "animate-in fade-in-0 slide-in-from-left-2 duration-200",
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <Brain className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{activeLabel}</span>
          <button
            onClick={handleRemove}
            className="ml-0.5 p-0.5 rounded-full cursor-pointer hover:bg-primary/20 transition-colors text-primary/60 hover:text-primary"
            title="Turn off reasoning"
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 cursor-pointer rounded-full text-tertiary/50 hover:text-tertiary hover:bg-tertiary/5 transition-colors"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          title="Reasoning"
        >
          <Brain className="h-4 w-4" />
        </Button>
      )}

      {isOpen && (
        <div
          className={cn(
            "absolute bottom-full right-0 sm:left-0 sm:right-auto mb-2 z-50",
            "bg-dropdown-bg rounded-2xl shadow-xl",
            "border border-tertiary/8",
            "py-2 min-w-[180px]",
            "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
          )}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-tertiary/50 uppercase tracking-wider">
            Reasoning Effort
          </div>
          {EFFORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              disabled={disabled}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tertiary/5 transition-colors text-left",
                reasoningEffort === option.value &&
                  "bg-primary/5 text-primary",
              )}
            >
              <Brain
                className={cn(
                  "h-4 w-4",
                  reasoningEffort === option.value
                    ? "text-primary"
                    : "text-tertiary/40",
                  option.value === "off" && "opacity-50",
                )}
              />
              <span
                className={cn(
                  "text-sm",
                  reasoningEffort === option.value
                    ? "font-medium"
                    : "text-tertiary",
                )}
              >
                {option.label}
              </span>
              {reasoningEffort === option.value && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
