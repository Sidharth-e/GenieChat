"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Trophy,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import { useArenaLeaderboard } from "@/hooks/use-arena-queries";
import { GoogleIcon, OllamaIcon, OpenRouterIcon } from "../common/custom-icons";

const providerIcons: Record<string, React.ReactNode> = {
  google: <GoogleIcon className="h-4 w-4" />,
  ollama: <OllamaIcon className="h-4 w-4" />,
  openrouter: <OpenRouterIcon className="h-4 w-4" />,
};

interface ArenaLeaderboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EloBar({ rating, max }: { rating: number; max: number }) {
  const percentage = Math.min(((rating - 800) / (max - 800 + 200)) * 100, 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-tertiary/10">
      <div
        className="h-full rounded-full bg-primary/60 transition-all duration-500"
        style={{ width: `${Math.max(percentage, 5)}%` }}
      />
    </div>
  );
}

function WinRate({
  wins,
  losses,
  ties,
}: {
  wins: number;
  losses: number;
  ties: number;
}) {
  const total = wins + losses + ties;
  if (total === 0) return <span className="text-tertiary/40">—</span>;
  const rate = Math.round((wins / total) * 100);
  return (
    <span
      className={cn(
        "text-xs font-medium",
        rate >= 60
          ? "text-green-500"
          : rate >= 40
            ? "text-yellow-500"
            : "text-red-500",
      )}
    >
      {rate}%
    </span>
  );
}

export function ArenaLeaderboard({
  open,
  onOpenChange,
}: ArenaLeaderboardProps) {
  const { data, isLoading } = useArenaLeaderboard(open);
  const entries = data?.entries ?? [];
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  const maxElo =
    entries.length > 0 ? Math.max(...entries.map((e) => e.eloRating)) : 1200;

  const modalContent = (
    <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-tertiary/10 bg-secondary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-tertiary/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Trophy className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Arena Leaderboard
              </h2>
              <p className="text-[11px] text-tertiary/60">
                Your personalized model rankings
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="max-h-[420px] overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center">
              <BarChart3 className="mx-auto mb-3 h-8 w-8 text-tertiary/30" />
              <p className="text-sm text-tertiary/60">No arena data yet</p>
              <p className="mt-1 text-xs text-tertiary/40">
                Use Arena mode to compare models and build your leaderboard
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, index) => {
                const modelConfig = AVAILABLE_MODELS.find(
                  (m) => m.id === entry.modelId,
                );
                return (
                  <div
                    key={entry.modelId}
                    className={cn(
                      "rounded-xl border border-tertiary/10 p-3 transition-colors",
                      index === 0 && "border-primary/20 bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* Rank */}
                      <div
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                          index === 0
                            ? "bg-primary/10 text-primary"
                            : index === 1
                              ? "bg-tertiary/10 text-tertiary"
                              : "bg-tertiary/5 text-tertiary/60",
                        )}
                      >
                        #{index + 1}
                      </div>

                      {/* Provider icon + name */}
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-tertiary/10">
                          {providerIcons[entry.provider] || (
                            <BarChart3 className="h-3.5 w-3.5 text-tertiary/50" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-foreground">
                            {modelConfig?.name || entry.modelName}
                          </div>
                          <div className="text-[10px] text-tertiary/50">
                            {entry.provider}
                          </div>
                        </div>
                      </div>

                      {/* Elo */}
                      <div className="text-right">
                        <div className="text-sm font-bold text-foreground">
                          {entry.eloRating}
                        </div>
                        <div className="text-[10px] text-tertiary/50">Elo</div>
                      </div>
                    </div>

                    {/* Stats bar */}
                    <div className="mt-2.5">
                      <EloBar rating={entry.eloRating} max={maxElo} />
                    </div>

                    {/* Stats row */}
                    <div className="mt-2 flex items-center gap-4 text-[10px] text-tertiary/50">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-green-500" />
                        {entry.wins}W
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingDown className="h-3 w-3 text-red-500" />
                        {entry.losses}L
                      </span>
                      <span className="flex items-center gap-1">
                        <Minus className="h-3 w-3" />
                        {entry.ties}T
                      </span>
                      <span className="flex items-center gap-1">
                        Win rate:{" "}
                        <WinRate
                          wins={entry.wins}
                          losses={entry.losses}
                          ties={entry.ties}
                        />
                      </span>
                      {entry.avgLatencyMs > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {(entry.avgLatencyMs / 1000).toFixed(1)}s avg
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
