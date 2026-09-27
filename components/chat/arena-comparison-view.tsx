"use client";

import * as React from "react";
import { Trophy, Clock, Zap, Equal, Crown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageContent } from "@/components/common/message-content";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";
import type { ArenaMetadata, ArenaResponse } from "@/lib/types";
import { useArenaStore, type ArenaStreamingState } from "@/lib/stores/arena";

interface ArenaComparisonViewProps {
  arenaMetadata: ArenaMetadata;
  messageId: string;
  isStreaming?: boolean;
  onVoteWinner: (messageId: string, winnerId: string | null) => void;
}

/* ──────────────────────── Individual Response Panel ──────────────────────── */

function ArenaPanel({
  response,
  streamingState,
  isWinner,
  isActive,
  onClick,
}: {
  response?: ArenaResponse;
  streamingState?: ArenaStreamingState;
  isWinner: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const content = streamingState?.content || response?.content || "";
  const isCurrentlyStreaming = streamingState?.isStreaming ?? false;
  const modelConfig = AVAILABLE_MODELS.find(
    (m) => m.id === (response?.modelId || ""),
  );
  const latency = response?.latencyMs || streamingState?.latencyMs || 0;
  const tokens = response?.tokens || streamingState?.tokens;
  const error = response?.error || streamingState?.error;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/panel relative flex w-lg shrink-0 flex-col text-left transition-all duration-300",
        "rounded-2xl border-2 outline-none",
        isActive
          ? isWinner
            ? "border-primary bg-primary/4 shadow-[0_0_0_1px_rgba(16,163,127,0.1),0_8px_32px_rgba(16,163,127,0.08)]"
            : "border-primary/40 bg-secondary/60 shadow-[0_2px_20px_rgba(0,0,0,0.06)]"
          : isWinner
            ? "border-primary/20 bg-primary/2"
            : "border-transparent bg-secondary/30 hover:bg-secondary/50 hover:border-tertiary/10",
        error && "border-red-500/20 bg-red-500/3",
      )}
    >
      {/* Winner crown */}
      {isWinner && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 shadow-sm">
            <Crown className="h-3 w-3 text-background" />
            <span className="text-[10px] font-semibold tracking-wide text-background uppercase">
              Winner
            </span>
          </div>
        </div>
      )}

      {/* Model Identity Header */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 pt-4 pb-3",
          isWinner && "pt-5",
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold uppercase tracking-wider transition-colors",
            isActive
              ? "bg-primary/10 text-primary"
              : "bg-tertiary/6 text-tertiary/40",
          )}
        >
          {(modelConfig?.provider || "ai").slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {modelConfig?.name || response?.modelId || "Loading..."}
          </p>
          <p className="text-[11px] text-tertiary/40 capitalize">
            {modelConfig?.provider || response?.provider || ""}
          </p>
        </div>

        {/* Inline stats */}
        {!isCurrentlyStreaming && content && (
          <div className="flex shrink-0 items-center gap-2.5">
            {latency > 0 && (
              <span className="flex items-center gap-1 text-[10px] tabular-nums text-tertiary/35">
                <Clock className="h-3 w-3" />
                {(latency / 1000).toFixed(1)}s
              </span>
            )}
            {tokens && tokens.completion > 0 && (
              <span className="flex items-center gap-1 text-[10px] tabular-nums text-tertiary/35">
                <Zap className="h-3 w-3" />
                {tokens.completion}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-tertiary/6" />

      {/* Content Area */}
      <div className="flex-1 px-4 py-3">
        {error ? (
          <p className="py-6 text-center text-sm text-red-400/80">{error}</p>
        ) : isCurrentlyStreaming && !content ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce-dot"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
              <span className="ml-1 text-xs text-tertiary/40">Generating</span>
            </div>
          </div>
        ) : (
          <div className="h-80 overflow-y-auto">
            <MessageContent
              content={content}
              isUser={false}
              isStreaming={isCurrentlyStreaming}
            />
          </div>
        )}
      </div>
    </button>
  );
}

/* ────────────────────────── Tab-style Model Switcher ─────────────────────── */

function ModelTabs({
  responses,
  activeModel,
  onSelect,
  winnerId,
}: {
  responses: { modelId: string; error?: string }[];
  activeModel: string;
  onSelect: (modelId: string) => void;
  winnerId: string | null;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-secondary/60 p-1 sm:hidden">
      {responses.map(({ modelId }) => {
        const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
        const isActive = modelId === activeModel;
        const isWinner = modelId === winnerId;

        return (
          <button
            key={modelId}
            type="button"
            onClick={() => onSelect(modelId)}
            className={cn(
              "relative flex-1 rounded-lg px-3 py-2 text-center text-xs font-medium transition-all duration-200",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-tertiary/50 hover:text-tertiary/70",
            )}
          >
            <span className="flex items-center justify-center gap-1.5 truncate">
              {isWinner && <Crown className="h-3 w-3 text-primary" />}
              {model?.name || modelId}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Vote Bar ──────────────────────────────────────── */

function VoteBar({
  responses,
  messageId,
  onVote,
}: {
  responses: ArenaResponse[];
  messageId: string;
  onVote: (messageId: string, winnerId: string | null) => void;
}) {
  const validResponses = responses.filter((r) => !r.error);
  if (validResponses.length === 0) return null;

  return (
    <div className="animate-slide-up flex flex-col items-center gap-3 rounded-2xl border border-tertiary/6 bg-secondary/40 px-5 py-4 backdrop-blur-sm">
      <p className="text-xs font-medium tracking-wide text-tertiary/50 uppercase">
        Which response is better?
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {validResponses.map((response) => {
          const model = AVAILABLE_MODELS.find((m) => m.id === response.modelId);
          return (
            <button
              key={response.modelId}
              type="button"
              onClick={() => onVote(messageId, response.modelId)}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-4 py-2.5",
                "border border-tertiary/10 bg-background",
                "text-sm font-medium text-foreground",
                "transition-all duration-200",
                "hover:border-primary/30 hover:bg-primary/5 hover:text-primary hover:shadow-md hover:shadow-primary/5",
                "active:scale-[0.97]",
              )}
            >
              <Trophy className="h-3.5 w-3.5 text-tertiary/30 transition-colors group-hover:text-primary" />
              {model?.name || response.modelId}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onVote(messageId, null)}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2.5",
            "border border-dashed border-tertiary/10 bg-transparent",
            "text-sm text-tertiary/40",
            "transition-all duration-200",
            "hover:border-tertiary/20 hover:text-tertiary/60 hover:bg-tertiary/3",
            "active:scale-[0.97]",
          )}
        >
          <Equal className="h-3.5 w-3.5" />
          It&apos;s a tie
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────── Voted Banner (collapsed state) ─────────────────── */

function VotedBanner({
  arenaMetadata,
  onExpand,
}: {
  arenaMetadata: ArenaMetadata;
  onExpand: () => void;
}) {
  const winnerModel = AVAILABLE_MODELS.find(
    (m) => m.id === arenaMetadata.winnerId,
  );
  const isTie = !arenaMetadata.winnerId;

  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-200",
        "border border-tertiary/6 bg-secondary/30",
        "hover:bg-secondary/50 hover:border-tertiary/10",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
          isTie ? "bg-tertiary/6" : "bg-primary/10",
        )}
      >
        {isTie ? (
          <Equal className="h-4 w-4 text-tertiary/50" />
        ) : (
          <Trophy className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {isTie
            ? "Arena — Tied"
            : `Arena — ${winnerModel?.name || arenaMetadata.winnerId} won`}
        </p>
        <p className="text-[11px] text-tertiary/40">
          {arenaMetadata.responses.length} models compared
          {" · "}
          <span className="text-primary/60 group-hover:text-primary transition-colors">
            View comparison
          </span>
        </p>
      </div>
      <Check className="h-4 w-4 shrink-0 text-primary/40" />
    </button>
  );
}

/* ═══════════════════════ Main Component ═══════════════════════════════════ */

export function ArenaComparisonView({
  arenaMetadata,
  messageId,
  isStreaming,
  onVoteWinner,
}: ArenaComparisonViewProps) {
  const activeArenaResponses = useArenaStore(
    (state) => state.activeArenaResponses,
  );
  const isArenaStreaming = useArenaStore((state) => state.isArenaStreaming);
  const [showComparison, setShowComparison] = React.useState(
    !arenaMetadata.winnerId,
  );

  // For mobile tab view
  const allModelIds = React.useMemo(() => {
    if (arenaMetadata.responses.length > 0) {
      return arenaMetadata.responses.map((r) => r.modelId);
    }
    return Object.keys(activeArenaResponses);
  }, [arenaMetadata.responses, activeArenaResponses]);

  const [activeTab, setActiveTab] = React.useState(allModelIds[0] || "");

  React.useEffect(() => {
    if (allModelIds.length > 0 && !allModelIds.includes(activeTab)) {
      setActiveTab(allModelIds[0]);
    }
  }, [allModelIds, activeTab]);

  const isVoted = Boolean(arenaMetadata.winnerId || arenaMetadata.votedAt);
  const useStreamingData = isStreaming || isArenaStreaming;

  // Collapsed voted state
  if (isVoted && !showComparison) {
    return (
      <VotedBanner
        arenaMetadata={arenaMetadata}
        onExpand={() => setShowComparison(true)}
      />
    );
  }

  // Build response list (from metadata or streaming store)
  const responseEntries =
    arenaMetadata.responses.length > 0
      ? arenaMetadata.responses.map((r) => ({
          modelId: r.modelId,
          response: r,
          streamingState: useStreamingData
            ? activeArenaResponses[r.modelId]
            : undefined,
        }))
      : Object.entries(activeArenaResponses).map(([modelId, streamState]) => ({
          modelId,
          response: {
            modelId,
            modelName:
              AVAILABLE_MODELS.find((m) => m.id === modelId)?.name || modelId,
            provider:
              AVAILABLE_MODELS.find((m) => m.id === modelId)?.provider ||
              "unknown",
            content: "",
            latencyMs: 0,
            finishedAt: "",
          } as ArenaResponse,
          streamingState: streamState,
        }));

  return (
    <div className="animate-fade-in -mx-16 lg:-mx-32 xl:-mx-48 space-y-3">
      {/* Mobile: Tab switcher (hidden on sm+) */}
      <ModelTabs
        responses={responseEntries.map((e) => ({
          modelId: e.modelId,
          error: e.response?.error,
        }))}
        activeModel={activeTab}
        onSelect={setActiveTab}
        winnerId={arenaMetadata.winnerId}
      />

      {/* Desktop: horizontally scrollable cards | Mobile: single active panel */}
      <div className="hidden gap-3 overflow-x-auto pt-4 pb-2 sm:flex">
        {responseEntries.map((entry) => (
          <ArenaPanel
            key={entry.modelId}
            response={entry.response}
            streamingState={entry.streamingState}
            isWinner={arenaMetadata.winnerId === entry.modelId}
            isActive={true}
            onClick={() => {}}
          />
        ))}
      </div>

      {/* Mobile: show only active tab */}
      <div className="sm:hidden">
        {responseEntries
          .filter((e) => e.modelId === activeTab)
          .map((entry) => (
            <ArenaPanel
              key={entry.modelId}
              response={entry.response}
              streamingState={entry.streamingState}
              isWinner={arenaMetadata.winnerId === entry.modelId}
              isActive={true}
              onClick={() => {}}
            />
          ))}
      </div>

      {/* Vote bar */}
      {!isVoted && !useStreamingData && arenaMetadata.responses.length > 0 && (
        <VoteBar
          responses={arenaMetadata.responses}
          messageId={messageId}
          onVote={onVoteWinner}
        />
      )}

      {/* Collapse button after voting */}
      {isVoted && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowComparison(false)}
            className="text-xs text-tertiary/40 hover:text-tertiary/60 transition-colors"
          >
            Hide comparison
          </button>
        </div>
      )}
    </div>
  );
}

