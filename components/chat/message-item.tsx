"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AttachedDocuments, AttachedImages } from "./message-attachments";
import { ToolCallGroup } from "./tool-call-block";
import { MessageContent } from "@/components/common/message-content";
import { MessageActions } from "@/components/common/message-actions";
import { DeepResearchReportCard } from "./deep-research-report-card";
import { ChatLoadingIndicator } from "./chat-loading-indicator";
import { ArenaComparisonView } from "./arena-comparison-view";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

const AGENT_BADGE_COLORS = [
  "border-blue-500 bg-blue-500",
  "border-emerald-500 bg-emerald-500",
  "border-purple-500 bg-purple-500",
  "border-amber-500 bg-amber-500",
  "border-rose-500 bg-rose-500",
  "border-cyan-500 bg-cyan-500",
  "border-indigo-500 bg-indigo-500",
  "border-teal-500 bg-teal-500",
];

function getAgentBadgeColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_BADGE_COLORS[Math.abs(hash) % AGENT_BADGE_COLORS.length];
}

interface MessageItemProps {
  message: Message;
  name?: string;
  isStreaming?: boolean;
  onRegenerate?: (messageId: string) => void | Promise<void>;
  canRegenerate?: boolean;
  isRegenerating?: boolean;
  onEditSubmit?: (
    messageId: string,
    newContent: string,
  ) => void | Promise<void>;
  onVersionChange?: (messageId: string, newIndex: number) => void;
  onFeedbackChange?: (
    messageId: string,
    versionId: string,
    feedback: "like" | "dislike" | null,
  ) => void;
  onArenaVote?: (messageId: string, winnerId: string | null) => void;
  agentNames?: string[];
}

const USER_MESSAGE_COLLAPSE_THRESHOLD = 320;
const USER_MESSAGE_PREVIEW_LENGTH = 190;

function MessageItemComponent({
  message,
  name = "Assistant",
  isStreaming,
  onRegenerate,
  canRegenerate = false,
  isRegenerating = false,
  onEditSubmit,
  onVersionChange,
  onFeedbackChange,
  onArenaVote,
  agentNames = [],
}: MessageItemProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editContent, setEditContent] = React.useState(message.content);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [isEditing]);

  const handleEditSubmit = async () => {
    if (!onEditSubmit) return;
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === displayMessage.content) {
      setIsEditing(false);
      return;
    }

    setIsEditing(false);
    await onEditSubmit(displayMessage.id, trimmed);
  };
  const versions = React.useMemo(() => {
    if (message.versions && message.versions.length > 0) {
      return message.versions;
    }

    return [
      {
        versionId: `legacy-${message.id}`,
        content: message.content,
        model: message.model,
        toolCalls: message.toolCalls,
        documents: message.documents,
        images: message.images,
        tokens: message.tokens,
        citations: message.citations,
        researchReport: message.researchReport,
        createdAt: message.createdAt,
      },
    ];
  }, [message]);

  const clampIndex = React.useCallback(
    (index: number) =>
      Math.min(Math.max(index, 0), Math.max(versions.length - 1, 0)),
    [versions.length],
  );

  const [visibleVersionIndex, setVisibleVersionIndex] = React.useState(
    clampIndex(
      typeof message.activeVersionIndex === "number"
        ? message.activeVersionIndex
        : versions.length - 1,
    ),
  );

  const activeVersionIndex = clampIndex(
    typeof message.activeVersionIndex === "number"
      ? message.activeVersionIndex
      : versions.length - 1,
  );

  React.useEffect(() => {
    const nextIndex = clampIndex(
      typeof message.activeVersionIndex === "number"
        ? message.activeVersionIndex
        : versions.length - 1,
    );
    setVisibleVersionIndex(nextIndex);
  }, [clampIndex, message.activeVersionIndex, message.id, versions.length]);

  const selectedVersionIndex = clampIndex(visibleVersionIndex);
  const selectedVersion = versions[selectedVersionIndex];
  const selectedVersionIsUnsynced =
    selectedVersionIndex === activeVersionIndex &&
    ((!selectedVersion.content?.trim() && Boolean(message.content?.trim())) ||
      message.content !== selectedVersion.content);
  const versionedMessage = React.useMemo(() => {
    const resolvedVersion = selectedVersionIsUnsynced
      ? {
          ...selectedVersion,
          content: message.content,
          model: selectedVersion.model ?? message.model,
          toolCalls: selectedVersion.toolCalls ?? message.toolCalls,
          documents: selectedVersion.documents ?? message.documents,
          images: selectedVersion.images ?? message.images,
          tokens: selectedVersion.tokens ?? message.tokens,
          citations: selectedVersion.citations ?? message.citations,
          researchReport:
            selectedVersion.researchReport ?? message.researchReport,
        }
      : selectedVersion;

    return {
      ...message,
      content: resolvedVersion.content,
      model: resolvedVersion.model,
      toolCalls: resolvedVersion.toolCalls,
      documents: resolvedVersion.documents,
      images: resolvedVersion.images,
      tokens: resolvedVersion.tokens,
      citations: resolvedVersion.citations,
      researchReport: resolvedVersion.researchReport,
      feedback: resolvedVersion.feedback ?? message.feedback,
      activeVersionIndex: selectedVersionIndex,
      versions,
    };
  }, [
    message,
    selectedVersion,
    selectedVersionIndex,
    selectedVersionIsUnsynced,
    versions,
  ]);
  const displayMessage = isStreaming ? message : versionedMessage;

  const isUser = displayMessage.role === "user";
  const isLongUserMessage =
    isUser &&
    (displayMessage.content?.trim().length ?? 0) >
      USER_MESSAGE_COLLAPSE_THRESHOLD;
  const [isUserMessageExpanded, setIsUserMessageExpanded] =
    React.useState(false);
  const userMessagePreview = React.useMemo(() => {
    const content = displayMessage.content?.trim() ?? "";
    if (content.length <= USER_MESSAGE_PREVIEW_LENGTH) {
      return content;
    }

    return `${content.slice(0, USER_MESSAGE_PREVIEW_LENGTH).trimEnd()}...`;
  }, [displayMessage.content]);

  React.useEffect(() => {
    setIsUserMessageExpanded(false);
  }, [displayMessage.id, displayMessage.content]);

  const isArenaMessage =
    !isUser && displayMessage.arenaMetadata?.isArena;
  const isArenaVoted =
    isArenaMessage && Boolean(displayMessage.arenaMetadata?.winnerId || displayMessage.arenaMetadata?.votedAt);
  const isArenaUnvoted = isArenaMessage && !isArenaVoted;
  const hasContent =
    (Boolean(displayMessage.content) || (!isUser && Boolean(isStreaming))) &&
    !isArenaUnvoted;
  const shouldRenderCollapsedUserMessage =
    isLongUserMessage && !isUserMessageExpanded && !isStreaming;
  const shouldRenderInlineLoadingIndicator =
    !isUser &&
    Boolean(isStreaming) &&
    !displayMessage.content?.trim() &&
    !displayMessage.toolCalls?.length &&
    !displayMessage.documents?.length &&
    !displayMessage.images?.length &&
    !displayMessage.researchReport;

  if (shouldRenderInlineLoadingIndicator) {
    return (
      <ChatLoadingIndicator
        displayName={name}
        modelName={displayMessage.model}
      />
    );
  }

  return (
    <div
      className={cn(
        "group px-3 py-3 transition-colors duration-200 sm:px-5 sm:py-4",
      )}
    >
      <div
        className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
      >
        <div
          className={cn(
            "min-w-0 space-y-1",
            isUser
              ? "flex w-full max-w-[88%] flex-col items-end sm:max-w-[75%]"
              : "w-full",
          )}
        >
          {/* Arena Comparison View */}
          {!isUser &&
            displayMessage.arenaMetadata?.isArena &&
            onArenaVote && (
              <ArenaComparisonView
                arenaMetadata={displayMessage.arenaMetadata}
                messageId={displayMessage.id}
                isStreaming={isStreaming}
                onVoteWinner={onArenaVote}
              />
            )}

          {!isUser && !isArenaUnvoted && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={cn(
                "rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-background shadow-sm",
                message.agentId ? getAgentBadgeColor(message.agentId) : "bg-primary",
              )}>
                {name}
              </span>
              {(() => {
                const modelLabel = isArenaVoted && displayMessage.arenaMetadata?.winnerId
                  ? (AVAILABLE_MODELS.find((m) => m.id === displayMessage.arenaMetadata!.winnerId)?.name
                    || displayMessage.arenaMetadata.winnerId)
                  : displayMessage.model;
                return modelLabel ? (
                  <span className="rounded-full border border-tertiary/10 bg-tertiary/5 px-2 py-0.5 text-[0.6875rem] font-medium text-tertiary/60">
                    {modelLabel}
                  </span>
                ) : null;
              })()}
            </div>
          )}

          <AttachedDocuments
            documents={displayMessage.documents || []}
            alignment={isUser ? "right" : "left"}
          />

          <AttachedImages
            images={displayMessage.images || []}
            alignment={isUser ? "right" : "left"}
          />

          {!isUser &&
            displayMessage.toolCalls &&
            displayMessage.toolCalls.length > 0 && (
              <div className="mt-1">
                <ToolCallGroup
                  toolCalls={displayMessage.toolCalls}
                  isStreaming={isStreaming}
                />
              </div>
            )}

          {hasContent && !isEditing && (
            <div
              className={cn(
                "min-w-0",
                isUser
                  ? "w-fit max-w-full border-l-2 border-tertiary/20 pl-4 pr-1 py-1"
                  : "",
              )}
            >
              {shouldRenderCollapsedUserMessage ? (
                <button
                  type="button"
                  onClick={() => setIsUserMessageExpanded(true)}
                  className="flex w-full max-w-[560px] items-start gap-3 text-left"
                  aria-expanded={false}
                  aria-label="Expand user message"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-4 whitespace-pre-wrap wrap-break-words text-sm leading-6 text-foreground">
                      {userMessagePreview}
                    </p>
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-tertiary/80">
                      Show full message
                    </p>
                  </div>
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-tertiary/80" />
                </button>
              ) : (
                <div className="relative">
                  {isLongUserMessage && !isStreaming && (
                    <button
                      type="button"
                      onClick={() => setIsUserMessageExpanded(false)}
                      className="absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-md text-tertiary/80 transition-colors hover:text-foreground"
                      aria-expanded
                      aria-label="Collapse user message"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div
                    className={cn(isLongUserMessage && !isStreaming && "pr-6")}
                  >
                    <MessageContent
                      content={displayMessage.content}
                      isUser={isUser}
                      isStreaming={isStreaming}
                      citations={displayMessage.citations}
                      agentNames={agentNames}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isUser && isEditing && (
            <div className="flex w-full flex-col gap-3 rounded-2xl border border-tertiary/10 bg-tertiary/5 p-4 sm:w-[420px]">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[100px] w-full resize-none rounded-xl border border-tertiary/10 bg-secondary p-3 text-sm leading-relaxed focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10"
                placeholder="Edit your message..."
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-tertiary/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSubmit}
                  disabled={!editContent.trim()}
                  className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-background shadow-sm transition-all disabled:opacity-50 hover:brightness-105"
                >
                  Save & Submit
                </button>
              </div>
            </div>
          )}

          {!isUser && displayMessage.researchReport && (
            <DeepResearchReportCard
              title={displayMessage.researchReport.title}
              createdAt={displayMessage.researchReport.createdAt}
              reportRef={displayMessage.researchReport.reportRef}
              reportId={displayMessage.researchReport.id}
            />
          )}

          {displayMessage.content && !isStreaming && !isArenaUnvoted && (
            <MessageActions
              content={displayMessage.content}
              messageId={displayMessage.id}
              threadId={displayMessage.threadId}
              versionId={selectedVersion.versionId}
              initialFeedback={displayMessage.feedback}
              onRegenerate={
                onRegenerate && !isUser
                  ? () => onRegenerate(displayMessage.id)
                  : undefined
              }
              canRegenerate={canRegenerate && !isUser}
              isRegenerating={isRegenerating}
              activeVersionIndex={clampIndex(visibleVersionIndex)}
              versionCount={versions.length}
              onVersionChange={(delta) => {
                const nextIndex = clampIndex(visibleVersionIndex + delta);
                setVisibleVersionIndex(nextIndex);
                if (onVersionChange) {
                  onVersionChange(displayMessage.id, nextIndex);
                }
              }}
              isUser={isUser}
              onEdit={isUser ? () => setIsEditing(true) : undefined}
              onFeedbackChange={(feedback) => {
                if (onFeedbackChange) {
                  onFeedbackChange(
                    displayMessage.id,
                    selectedVersion.versionId,
                    feedback,
                  );
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function areMessageItemPropsEqual(
  prevProps: Readonly<MessageItemProps>,
  nextProps: Readonly<MessageItemProps>,
) {
  return (
    prevProps.message === nextProps.message &&
    prevProps.name === nextProps.name &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.canRegenerate === nextProps.canRegenerate &&
    prevProps.isRegenerating === nextProps.isRegenerating &&
    Boolean(prevProps.onRegenerate) === Boolean(nextProps.onRegenerate) &&
    Boolean(prevProps.onEditSubmit) === Boolean(nextProps.onEditSubmit) &&
    Boolean(prevProps.onVersionChange) === Boolean(nextProps.onVersionChange) &&
    Boolean(prevProps.onFeedbackChange) === Boolean(nextProps.onFeedbackChange) &&
    Boolean(prevProps.onArenaVote) === Boolean(nextProps.onArenaVote) &&
    prevProps.agentNames === nextProps.agentNames
  );
}

export const MessageItem = React.memo(
  MessageItemComponent,
  areMessageItemPropsEqual,
);

MessageItem.displayName = "MessageItem";
