"use client";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  Plus,
  MessageSquare,
  Bot,
  ChevronRight,
  ChevronLeft,
  Loader2,
  PinOff,
  Pin,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";

import { cn } from "@/lib/utils";
import { useQuickActionsStore } from "@/lib/stores";
import { useQuickActionsHandler } from "@/lib/hooks/use-quick-actions-handler";
import { useAgents } from "@/hooks/use-agents-queries";

export function QuickActionsPanel() {
  const { quickActions, setIsModalOpen, updateQuickAction } =
    useQuickActionsStore();
  const pinnedActions = quickActions.filter((a) => a.pinned);
  const { executeQuickAction, executingActionId } = useQuickActionsHandler();
  const { data: agents = [] } = useAgents();
  const [activeTab, setActiveTab] = useState<string>("all");

  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const agentTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const action of pinnedActions) {
      const key = action.agentId ?? "__chat__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      label: id === "__chat__" ? "Chat" : (agentMap.get(id) ?? "Unknown"),
      count,
    }));
  }, [pinnedActions, agentMap]);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTabsOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkTabsOverflow();
    const el = tabsRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkTabsOverflow);
    const ro = new ResizeObserver(checkTabsOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkTabsOverflow);
      ro.disconnect();
    };
  }, [checkTabsOverflow, agentTabs]);

  const scrollTabs = (direction: "left" | "right") => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction === "left" ? -120 : 120,
      behavior: "smooth",
    });
  };

  const filteredActions =
    activeTab === "all"
      ? pinnedActions
      : pinnedActions.filter(
          (a) =>
            (activeTab === "__chat__" && !a.agentId) || a.agentId === activeTab,
        );

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[0.8125rem] font-bold text-foreground tracking-tight">
            Quick Actions
          </h2>
          <p className="hidden text-[0.6875rem] text-text-secondary/70 sm:block">
            Saved prompts for repeat tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold text-primary transition-colors hover:text-primary/80"
          >
            Manage
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[0.6875rem] font-semibold text-background shadow-sm transition-all duration-200 hover:scale-[1.02] hover:brightness-105"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>
      </div>

      {pinnedActions.length > 0 && agentTabs.length > 1 && (
        <div className="relative mb-2">
          <LayoutGroup id="quick-actions-tabs">
          <div
            ref={tabsRef}
            className="flex overflow-y-hidden overflow-x-auto border-b border-card-border/40 scrollbar-none"
            style={{
              maskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 32px)"
                    : canScrollRight
                      ? "linear-gradient(to left, transparent, black 32px)"
                      : undefined,
              WebkitMaskImage:
                canScrollLeft && canScrollRight
                  ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                  : canScrollLeft
                    ? "linear-gradient(to right, transparent, black 32px)"
                    : canScrollRight
                      ? "linear-gradient(to left, transparent, black 32px)"
                      : undefined,
            }}
          >
            <button
              onClick={() => setActiveTab("all")}
              className={cn(
                "relative shrink-0 pb-1.5 pr-4 text-[12px] font-medium transition-colors",
                activeTab === "all"
                  ? "text-primary"
                  : "text-text-secondary hover:text-foreground",
              )}
            >
              All
              {activeTab === "all" && (
                <motion.div
                  layoutId="quick-actions-tab-indicator"
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary"
                />
              )}
            </button>
            {agentTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-2 pb-1.5 text-[12px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "text-primary"
                    : "text-text-secondary hover:text-foreground",
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "text-[10px]",
                    activeTab === tab.id
                      ? "text-primary/70"
                      : "text-text-secondary/50",
                  )}
                >
                  {tab.count > 0 && `(${tab.count})`}
                </span>
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="quick-actions-tab-indicator"
                    className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-primary"
                  />
                )}
              </button>
            ))}
          </div>

          <AnimatePresence>
            {canScrollLeft && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={() => scrollTabs("left")}
                className="absolute -left-2.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-card-border bg-card-bg shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                <ChevronLeft className="h-3 w-3" />
              </motion.button>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {canScrollRight && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={() => scrollTabs("right")}
                className="absolute -right-2.5 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-card-border bg-card-bg shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                <ChevronRight className="h-3 w-3" />
              </motion.button>
            )}
          </AnimatePresence>
          </LayoutGroup>
        </div>
      )}

      <AnimatePresence mode="wait">
        {pinnedActions.length > 0 ? (
          <motion.div
            key="actions-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {filteredActions.map((action, index) => (
              <motion.div
                key={action.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.25,
                  delay: index * 0.04,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
                role="button"
                tabIndex={executingActionId ? -1 : 0}
                onClick={() => !executingActionId && executeQuickAction(action)}
                onKeyDown={(e) => {
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    !executingActionId
                  ) {
                    e.preventDefault();
                    executeQuickAction(action);
                  }
                }}
                className={cn(
                  "group relative flex w-[185px] shrink-0 flex-col rounded-xl border border-card-border/60 bg-card-bg px-3 py-2.5 text-left",
                  "transition-all duration-200 cursor-pointer select-none",
                  "hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.1)]",
                  "dark:hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.3)]",
                  executingActionId && "cursor-not-allowed opacity-50",
                )}
              >
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-transparent transition-all hover:bg-hover-bg group-hover:text-text-secondary/40 hover:text-amber-500!"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateQuickAction(action.id, { pinned: false });
                  }}
                  title="Unpin action"
                >
                  <PinOff className="h-2.5 w-2.5" />
                </button>

                <div className="flex items-start gap-1.5">
                  <div
                    className={cn(
                      "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded",
                      action.medium === "agent"
                        ? "bg-primary/10 text-primary"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {action.medium === "chat" ? (
                      <MessageSquare className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                  </div>
                  <h3 className="min-w-0 flex-1 truncate pr-4 text-[12px] font-semibold leading-snug text-foreground">
                    {action.name}
                  </h3>
                </div>

                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
                  {action.prompt}
                </p>

                <div className="mt-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-hover-bg px-1.5 py-px font-mono text-[9px] text-text-secondary/70">
                      {action.medium === "chat" ? "chat" : "agent"}
                    </span>
                    {action.agentId && agentMap.has(action.agentId) && (
                      <span className="truncate rounded bg-indigo-500/10 px-1.5 py-px text-[9px] font-medium text-indigo-400">
                        {agentMap.get(action.agentId)}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="h-2.5 w-2.5 shrink-0 text-text-secondary/30 transition-colors group-hover:text-primary" />
                </div>

                {executingActionId === action.id && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-card-bg/80 backdrop-blur-[2px]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="no-pinned"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-md border border-dashed border-card-border/50 px-3 py-2.5"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary/50">
              <Pin className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-foreground/60">
                No actions pinned yet
              </p>
              <p className="text-[11px] text-text-secondary/70">
                Use{" "}
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="text-primary/70 hover:text-primary underline-offset-2 hover:underline transition-colors"
                >
                  Manage
                </button>{" "}
                to pin frequently-used prompts here.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
