"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Bot, Zap, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type MentionCategoryKey = "agents" | "commands";

export interface MentionItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: MentionCategoryKey;
  data?: unknown;
}

export interface MentionMenuProps {
  items: MentionItem[];
  onSelect: (item: MentionItem) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

export interface MentionMenuRef {
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

const CATEGORIES: {
  id: MentionCategoryKey;
  name: string;
  icon: React.ReactNode;
}[] = [
  { id: "agents", name: "Agents", icon: <Bot className="h-4 w-4" /> },
  { id: "commands", name: "Commands", icon: <Zap className="h-4 w-4" /> },
];

export const MentionMenu = React.forwardRef<MentionMenuRef, MentionMenuProps>(
  ({ items, onSelect, anchorRef, className }, ref) => {
    const rightScrollRef = React.useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = React.useState(false);
    const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 0 });

    const [leftIndex, setLeftIndex] = React.useState(0);
    const [rightIndex, setRightIndex] = React.useState(0);
    const [activePane, setActivePane] = React.useState<"left" | "right">(
      "right",
    );

    const categoriesWithItems = React.useMemo(() => {
      return CATEGORIES.filter((cat) =>
        items.some((item) => item.category === cat.id),
      );
    }, [items]);

    // Ensure leftIndex is valid
    const safeLeftIndex = Math.min(
      leftIndex,
      Math.max(0, categoriesWithItems.length - 1),
    );
    const activeCatId = categoriesWithItems[safeLeftIndex]?.id;

    const activeItems = React.useMemo(() => {
      return items.filter((item) => item.category === activeCatId);
    }, [items, activeCatId]);

    // Ensure rightIndex is valid
    const safeRightIndex = Math.min(
      rightIndex,
      Math.max(0, activeItems.length - 1),
    );

    React.useEffect(() => {
      setMounted(true);
    }, []);

    React.useEffect(() => {
      if (!anchorRef?.current || !mounted || items.length === 0) return;

      const updatePosition = () => {
        if (anchorRef.current) {
          const rect = anchorRef.current.getBoundingClientRect();
          setCoords({
            top: rect.top - 8,
            left: rect.left,
            width: rect.width,
          });
        }
      };

      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);

      const observer = new ResizeObserver(updatePosition);
      observer.observe(document.body);
      if (anchorRef.current) observer.observe(anchorRef.current);

      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
        observer.disconnect();
      };
    }, [anchorRef, items.length, mounted]);

    // Auto scroll right pane
    React.useEffect(() => {
      if (activePane === "right" && rightScrollRef.current) {
        const selectedEl = rightScrollRef.current.children[
          safeRightIndex
        ] as HTMLElement;
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: "nearest" });
        }
      }
    }, [safeRightIndex, activePane]);

    React.useImperativeHandle(ref, () => ({
      handleKeyDown: (e: React.KeyboardEvent) => {
        if (categoriesWithItems.length === 0) return false;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (activePane === "left") {
            setLeftIndex((prev) => (prev + 1) % categoriesWithItems.length);
            setRightIndex(0);
          } else {
            setRightIndex((prev) => (prev + 1) % activeItems.length);
          }
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (activePane === "left") {
            setLeftIndex(
              (prev) =>
                (prev - 1 + categoriesWithItems.length) %
                categoriesWithItems.length,
            );
            setRightIndex(0);
          } else {
            setRightIndex(
              (prev) => (prev - 1 + activeItems.length) % activeItems.length,
            );
          }
          return true;
        }
        if (e.key === "ArrowLeft") {
          if (activePane === "right") {
            e.preventDefault();
            setActivePane("left");
            return true;
          }
        }
        if (e.key === "ArrowRight") {
          if (activePane === "left" && activeItems.length > 0) {
            e.preventDefault();
            setActivePane("right");
            return true;
          }
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (activePane === "right" && activeItems[safeRightIndex]) {
            onSelect(activeItems[safeRightIndex]);
          } else if (activePane === "left" && activeItems.length > 0) {
            setActivePane("right");
          }
          return true;
        }
        return false;
      },
    }));

    // Reset right index when category changes
    React.useEffect(() => {
      setRightIndex(0);
    }, [activeCatId]);

    if (items.length === 0 || !mounted) return null;

    const content = (
      <div
        style={
          anchorRef
            ? {
                position: "fixed",
                top: coords.top,
                left: coords.left,
                transform: "translateY(-100%)",
              }
            : undefined
        }
        className={cn(
          !anchorRef && "absolute bottom-full left-0 mb-2",
          "w-64 overflow-visible rounded-2xl border border-tertiary/8 bg-dropdown-bg p-1.5 shadow-xl z-100 animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
      >
        <div className="text-[10px] text-tertiary/50 uppercase tracking-wider px-3 py-1.5 font-semibold">
          Mentions
        </div>
        <div className="h-px bg-tertiary/10 mx-1 mb-1.5" />

        <div className="max-h-[210px] overflow-y-auto overflow-x-hidden space-y-0.5">
          {categoriesWithItems.map((category, idx) => {
            const catItems = items.filter((m) => m.category === category.id);
            const isActiveCat = activeCatId === category.id;
            const isSelectedLeft =
              activePane === "left" && safeLeftIndex === idx;

            return (
              <button
                key={category.id}
                type="button"
                onMouseEnter={() => {
                  setLeftIndex(idx);
                  setRightIndex(0);
                  setActivePane("right");
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 cursor-pointer text-left rounded-lg transition-colors",
                  "hover:bg-tertiary/5 focus:bg-tertiary/5",
                  isActiveCat && "bg-tertiary/5",
                  isSelectedLeft && "ring-1 ring-primary/50 bg-tertiary/10",
                )}
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 bg-tertiary/10 transition-colors">
                  {category.icon}
                </div>
                <div className="flex-1 flex flex-col justify-center min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground leading-none">
                      {category.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-tertiary/60 leading-none mt-1.5">
                    {catItems.length} {catItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-tertiary/60 shrink-0" />
              </button>
            );
          })}
        </div>

        {activeCatId && activeItems.length > 0 && (
          <div
            className={cn(
              "absolute top-0 z-110 w-[220px] rounded-xl border border-tertiary/8 bg-dropdown-bg p-1.5 shadow-xl animate-in fade-in zoom-in-95",
              "left-[calc(100%+6px)]",
            )}
          >
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-tertiary/50 font-semibold">
              <span className="opacity-70">
                {CATEGORIES.find((c) => c.id === activeCatId)?.icon}
              </span>
              {CATEGORIES.find((c) => c.id === activeCatId)?.name}
            </div>
            <div className="h-px bg-tertiary/10 mx-1 mb-1.5" />
            <div
              className="max-h-[220px] space-y-0.5 overflow-y-auto overflow-x-hidden"
              ref={rightScrollRef}
            >
              {activeItems.map((item, idx) => {
                const isSelectedRight =
                  activePane === "right" && safeRightIndex === idx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => {
                      setActivePane("right");
                      setRightIndex(idx);
                    }}
                    onClick={() => onSelect(item)}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer",
                      isSelectedRight
                        ? "bg-tertiary/10 text-foreground"
                        : "text-tertiary hover:bg-tertiary/5 hover:text-foreground",
                    )}
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium truncate leading-tight">
                        {item.label}
                      </span>
                      {item.description && (
                        <span className="text-[10px] text-tertiary/50 truncate leading-tight mt-0.5">
                          {item.description}
                        </span>
                      )}
                    </div>
                    {isSelectedRight && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary ml-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );

    return anchorRef && mounted
      ? createPortal(content, document.body)
      : content;
  },
);

MentionMenu.displayName = "MentionMenu";

