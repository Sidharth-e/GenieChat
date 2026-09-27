"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Search,
  Brain,
  FileText,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type ResearchPhase = "searching" | "analyzing" | "synthesizing" | "reviewing";

const PHASES: {
  id: ResearchPhase;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "searching", label: "Search", icon: Search },
  { id: "analyzing", label: "Analyze", icon: Brain },
  { id: "synthesizing", label: "Synthesize", icon: FileText },
  { id: "reviewing", label: "Review", icon: ClipboardCheck },
];

function detectPhase(status: string): ResearchPhase {
  const s = status.toLowerCase();
  if (s.includes("analysis [iteration") || s.includes("knowledge gaps"))
    return "analyzing";
  if (
    s.includes("research phase complete") ||
    s.includes("draft generated") ||
    s.includes("synthesizing")
  )
    return "synthesizing";
  if (s.includes("review complete") || s.includes("revision complete"))
    return "reviewing";
  return "searching";
}

function extractMetrics(status: string): Record<string, string> {
  const m: Record<string, string> = {};
  const searchMatch = status.match(/Total:\s*(\d+)\s*searches/i);
  if (searchMatch) m.searches = searchMatch[1];
  const sourcesMatch = status.match(/Sources:\s*(\d+)/i);
  if (sourcesMatch) m.sources = sourcesMatch[1];
  const coverageMatch = status.match(/Coverage:\s*(\d+)%/i);
  if (coverageMatch) m.coverage = coverageMatch[1] + "%";
  const iterationMatch = status.match(/Iteration\s*(\d+)\/(\d+)/i);
  if (iterationMatch) m.iteration = `${iterationMatch[1]}/${iterationMatch[2]}`;
  const wordsMatch = status.match(/([\d,]+)\s*words/i);
  if (wordsMatch) m.words = wordsMatch[1];
  const scoreMatch = status.match(/Quality score:\s*(\d+)\/100/i);
  if (scoreMatch) m.score = `${scoreMatch[1]}/100`;
  return m;
}

function getCleanText(status: string): string {
  return (
    status
      .split("\n")[0]
      .replace(/\s*\|[^|]*/g, "")
      .trim() || status.split("\n")[0]
  );
}

function getDetailText(status: string): string {
  return status
    .split("\n")
    .slice(1)
    .join(" ")
    .replace(/^\s*->\s*/, "")
    .replace(/\s*->\s*/g, " · ")
    .trim();
}

function MetricPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border",
        accent
          ? "bg-primary/10 border-primary/20 text-primary"
          : "bg-secondary/50 border-border text-muted-foreground"
      )}
    >
      <span className="text-[10px] uppercase tracking-wide opacity-60">
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

interface DeepResearchStatusProps {
  statusHistory: string[];
  isComplete?: boolean;
}

export function DeepResearchStatus({
  statusHistory,
  isComplete,
}: DeepResearchStatusProps) {
  const [historyExpanded, setHistoryExpanded] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [statusHistory]);

  if (statusHistory.length === 0) return null;

  const currentStatus = statusHistory[statusHistory.length - 1];
  const pastStatuses = statusHistory.slice(0, -1);
  const currentPhase = isComplete ? null : detectPhase(currentStatus);
  const activePhaseIndex = isComplete
    ? PHASES.length
    : PHASES.findIndex((p) => p.id === currentPhase);

  const latestMetrics: Record<string, string> = {};
  for (const s of statusHistory) {
    Object.assign(latestMetrics, extractMetrics(s));
  }

  const visibleHistory = historyExpanded
    ? pastStatuses
    : pastStatuses.slice(-3);
  const hiddenCount = pastStatuses.length - visibleHistory.length;

  return (
    <div className="w-full my-4 space-y-3">
      {/* Phase Timeline */}
      <div className="flex items-center gap-1 p-3 rounded-xl bg-secondary/30 border border-border">
        {PHASES.map((phase, i) => {
          const Icon = phase.icon;
          const isDone = i < activePhaseIndex;
          const isActive = i === activePhaseIndex && !isComplete;

          return (
            <React.Fragment key={phase.id}>
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300",
                  isDone && "text-green-500 bg-green-500/10",
                  isActive && "text-primary bg-primary/10",
                  !isDone && !isActive && "text-muted-foreground"
                )}
              >
                {isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isActive && "animate-pulse"
                    )}
                  />
                )}
                <span className="hidden sm:inline">{phase.label}</span>
              </div>
              {i < PHASES.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-px transition-all duration-500",
                    i < activePhaseIndex ? "bg-green-500/40" : "bg-border"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}

        {isComplete && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-green-500 bg-green-500/10 ml-1">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Done</span>
          </div>
        )}
      </div>

      {/* Metrics */}
      {Object.keys(latestMetrics).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {latestMetrics.searches && (
            <MetricPill label="Searches" value={latestMetrics.searches} />
          )}
          {latestMetrics.sources && (
            <MetricPill label="Sources" value={latestMetrics.sources} />
          )}
          {latestMetrics.coverage && (
            <MetricPill
              label="Coverage"
              value={latestMetrics.coverage}
              accent
            />
          )}
          {latestMetrics.iteration && (
            <MetricPill label="Iteration" value={latestMetrics.iteration} />
          )}
          {latestMetrics.words && (
            <MetricPill label="Words" value={latestMetrics.words} accent />
          )}
          {latestMetrics.score && (
            <MetricPill label="Quality" value={latestMetrics.score} accent />
          )}
        </div>
      )}

      {/* History */}
      {pastStatuses.length > 0 && (
        <div className="space-y-0.5">
          {hiddenCount > 0 && !historyExpanded && (
            <button
              onClick={() => setHistoryExpanded(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-secondary/30 w-full"
            >
              <ChevronDown className="h-3 w-3" />
              {hiddenCount} earlier step{hiddenCount > 1 ? "s" : ""}
            </button>
          )}
          {historyExpanded && (
            <button
              onClick={() => setHistoryExpanded(false)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-secondary/30 w-full"
            >
              <ChevronUp className="h-3 w-3" />
              Collapse
            </button>
          )}
          {visibleHistory.map((status, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 px-3 py-1.5 rounded-lg"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500/60 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground/60 line-clamp-1">
                {getCleanText(status)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Current Step */}
      <div
        className={cn(
          "flex items-start gap-3 p-4 rounded-xl border transition-all duration-300",
          isComplete
            ? "bg-green-500/5 border-green-500/20"
            : "bg-primary/5 border-primary/20"
        )}
      >
        <div className="shrink-0 mt-0.5">
          {isComplete ? (
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-green-500/15">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </div>
          ) : (
            <div className="relative flex items-center justify-center h-6 w-6">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {isComplete ? (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              Research complete
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                {getCleanText(currentStatus)}
              </p>
              {getDetailText(currentStatus) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {getDetailText(currentStatus)}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
