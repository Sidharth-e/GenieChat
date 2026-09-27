"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Settings2, Globe, FileSearch, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolsMenuProps {
  isWebSearchEnabled?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  isDeepResearchEnabled?: boolean;
  onDeepResearchChange?: (enabled: boolean) => void;
  disabled?: boolean;
}

type ActiveTool = "web-search" | "deep-research" | null;

export function ToolsMenu({
  isWebSearchEnabled = false,
  onWebSearchChange,
  isDeepResearchEnabled = false,
  onDeepResearchChange,
  disabled = false,
}: ToolsMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Determine which tool is currently active (only one at a time)
  const activeTool: ActiveTool = isDeepResearchEnabled
    ? "deep-research"
    : isWebSearchEnabled
      ? "web-search"
      : null;

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

  const handleSelectTool = (tool: ActiveTool) => {
    // If selecting the same tool, deselect it
    if (tool === activeTool) {
      if (tool === "web-search" && onWebSearchChange) {
        onWebSearchChange(false);
      } else if (tool === "deep-research" && onDeepResearchChange) {
        onDeepResearchChange(false);
      }
    } else {
      // Deselect current tool first
      if (activeTool === "web-search" && onWebSearchChange) {
        onWebSearchChange(false);
      } else if (activeTool === "deep-research" && onDeepResearchChange) {
        onDeepResearchChange(false);
      }

      // Select new tool
      if (tool === "web-search" && onWebSearchChange) {
        onWebSearchChange(true);
      } else if (tool === "deep-research" && onDeepResearchChange) {
        onDeepResearchChange(true);
      }
    }
    setIsOpen(false);
  };

  const handleRemoveTool = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeTool === "web-search" && onWebSearchChange) {
      onWebSearchChange(false);
    } else if (activeTool === "deep-research" && onDeepResearchChange) {
      onDeepResearchChange(false);
    }
  };

  const getToolLabel = (tool: ActiveTool) => {
    switch (tool) {
      case "web-search":
        return "Web Search";
      case "deep-research":
        return "Deep Research";
      default:
        return "";
    }
  };

  const getToolIcon = (tool: ActiveTool) => {
    switch (tool) {
      case "web-search":
        return <Globe className="h-4 w-4" />;
      case "deep-research":
        return <FileSearch className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-2" ref={menuRef}>
      {/* Active Tool Pill */}
      {activeTool && (
        <div
          className={cn(
            "flex items-center gap-1.5 sm:gap-2 h-8 px-2 sm:px-3 rounded-full",
            "bg-secondary border border-tertiary/10",
            "text-tertiary text-sm font-medium",
            "animate-in fade-in-0 slide-in-from-left-2 duration-200",
          )}
        >
          <span
            className={cn(
              activeTool === "deep-research"
                ? "text-primary"
                : "text-green-500",
            )}
          >
            {getToolIcon(activeTool)}
          </span>
          <span className="hidden sm:inline">{getToolLabel(activeTool)}</span>
          <button
            onClick={handleRemoveTool}
            className="ml-0.5 p-0.5 rounded-full cursor-pointer hover:bg-tertiary/10 transition-colors text-tertiary/50 hover:text-tertiary"
            title="Remove tool"
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tools Menu Button - only show when no tool is active */}
      {!activeTool && (
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-2 sm:px-3 rounded-full transition-colors gap-1.5 sm:gap-2 cursor-pointer",
              "text-tertiary/50 hover:text-tertiary hover:bg-tertiary/5",
            )}
            disabled={disabled}
            onClick={() => setIsOpen(!isOpen)}
            title="Tools"
          >
            <Settings2 className="h-4 w-4" />
            <span className="text-sm font-medium hidden sm:inline">Tools</span>
          </Button>

          {isOpen && (
            <div
              className={cn(
                "absolute bottom-full left-0 mb-2 z-50",
                "bg-dropdown-bg rounded-2xl shadow-xl",
                "border border-tertiary/8",
                "py-2 min-w-[200px]",
                "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
              )}
            >
              {onDeepResearchChange && (
                <button
                  onClick={() => handleSelectTool("deep-research")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tertiary/5 transition-colors text-left"
                >
                  <FileSearch
                    className={cn(
                      "h-5 w-5",
                      activeTool === "deep-research"
                        ? "text-primary"
                        : "text-tertiary/70",
                    )}
                  />
                  <span className="text-sm text-tertiary">Deep Research</span>
                </button>
              )}

              {onWebSearchChange && (
                <button
                  onClick={() => handleSelectTool("web-search")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-tertiary/5 transition-colors text-left"
                >
                  <Globe
                    className={cn(
                      "h-5 w-5",
                      activeTool === "web-search"
                        ? "text-green-500"
                        : "text-tertiary/70",
                    )}
                  />
                  <span className="text-sm text-tertiary">Web Search</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
