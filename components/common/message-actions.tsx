"use client";

import { logger } from "@/lib/logger";
import * as React from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import {
  Copy,
  ThumbsUp,
  ThumbsDown,
  Check,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMessageSpeech } from "@/hooks/use-message-speech";

interface MessageActionsProps {
  content: string;
  messageId?: string;
  threadId?: string;
  versionId?: string;
  initialFeedback?: "like" | "dislike";
  onRegenerate?: () => void | Promise<void>;
  canRegenerate?: boolean;
  isRegenerating?: boolean;
  activeVersionIndex?: number;
  versionCount?: number;
  onVersionChange?: (delta: -1 | 1) => void;
  isUser?: boolean;
  onEdit?: () => void;
  onFeedbackChange?: (feedback: "like" | "dislike" | null) => void;
}

export function MessageActions({
  content,
  messageId,
  threadId,
  versionId,
  initialFeedback,
  onRegenerate,
  canRegenerate = false,
  isRegenerating = false,
  activeVersionIndex = 0,
  versionCount = 1,
  onVersionChange,
  isUser = false,
  onEdit,
  onFeedbackChange,
}: MessageActionsProps) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"like" | "dislike" | null>(
    initialFeedback || null,
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isRegeneratePending, setIsRegeneratePending] = React.useState(false);
  const { isSpeaking, isPaused, speak, pause } = useMessageSpeech(content);

  // Update local feedback state when initialFeedback changes (e.g. when changing versions)
  React.useEffect(() => {
    setFeedback(initialFeedback || null);
  }, [initialFeedback]);

  const handleCopy = async () => {
    try {
      if (typeof ClipboardItem !== "undefined") {
        let html = String(
          await unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkRehype)
            .use(rehypeStringify)
            .process(content),
        );
        // Inject inline styles so tables render with visible borders in Outlook, Word, etc.
        html = html
          .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;">')
          .replace(/<th>/g, '<th style="border:1px solid #ccc;padding:6px 12px;background:#f5f5f5;text-align:left;">')
          .replace(/<td>/g, '<td style="border:1px solid #ccc;padding:6px 12px;">');
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([content], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(content);
      }
    } catch {
      await navigator.clipboard.writeText(content);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = async (type: "like" | "dislike") => {
    if (!messageId || !threadId || isSubmitting) return;

    // Toggle off if same feedback
    const newFeedback = feedback === type ? null : type;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          messageId,
          versionId: versionId || "default", // Fallback for legacy
          feedback: type,
        }),
      });

      if (response.ok) {
        setFeedback(newFeedback);
        if (onFeedbackChange) {
          onFeedbackChange(newFeedback);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error("Failed to save feedback:", response.status, errorData);
      }
    } catch (error) {
      logger.error("Error saving feedback:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!onRegenerate || isRegenerating || isRegeneratePending) return;

    setIsRegeneratePending(true);
    try {
      await onRegenerate();
    } catch (error) {
      logger.error("Error regenerating message:", error);
    } finally {
      setIsRegeneratePending(false);
    }
  };

  const showRegenerate = canRegenerate && Boolean(onRegenerate);
  const regenerateDisabled =
    !onRegenerate || isRegenerating || isRegeneratePending;
  const hasMultipleVersions = versionCount > 1;
  const canGoPrev = activeVersionIndex > 0;
  const canGoNext = activeVersionIndex < versionCount - 1;

  return (
    <div
      className={cn(
        "flex w-full items-center gap-1 pt-2 transition-opacity duration-200",
        isUser && "justify-end opacity-0 group-hover:opacity-100",
      )}
    >
      {!isUser && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary hover:bg-tertiary/5"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 cursor-pointer rounded-lg hover:bg-tertiary/5",
              feedback === "like"
                ? "text-green-500 hover:text-green-600"
                : "text-tertiary/40 hover:text-tertiary",
            )}
            onClick={() => handleFeedback("like")}
            disabled={isSubmitting || !messageId || !threadId}
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 cursor-pointer rounded-lg hover:bg-tertiary/5",
              feedback === "dislike"
                ? "text-red-500 hover:text-red-600"
                : "text-tertiary/40 hover:text-tertiary",
            )}
            onClick={() => handleFeedback("dislike")}
            disabled={isSubmitting || !messageId || !threadId}
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary hover:bg-tertiary/5"
            onClick={isSpeaking ? pause : speak}
          >
            {isSpeaking ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className={cn("h-4 w-4", isPaused && "fill-current")} />
            )}
          </Button>
          {showRegenerate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary hover:bg-tertiary/5"
              onClick={handleRegenerate}
              disabled={regenerateDisabled}
              title="Regenerate response"
              aria-label="Regenerate response"
            >
              {isRegenerating || isRegeneratePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </Button>
          )}
        </>
      )}

      {isUser && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary hover:bg-tertiary/5"
            onClick={handleCopy}
            title="Copy message"
            aria-label="Copy message"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer rounded-lg text-tertiary/40 hover:text-tertiary hover:bg-tertiary/5"
              onClick={onEdit}
              title="Edit message"
              aria-label="Edit message"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </>
      )}

      {hasMultipleVersions && (
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md border border-tertiary/10 px-1 py-0.5 text-[11px] text-tertiary/60",
            !isUser && "ml-auto",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 cursor-pointer rounded-md text-tertiary/60 hover:text-tertiary hover:bg-tertiary/5"
            onClick={() => onVersionChange?.(-1)}
            disabled={!canGoPrev}
            title="Previous version"
            aria-label="Previous version"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-9 text-center tabular-nums">
            {activeVersionIndex + 1}/{versionCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 cursor-pointer rounded-md text-tertiary/60 hover:text-tertiary hover:bg-tertiary/5"
            onClick={() => onVersionChange?.(1)}
            disabled={!canGoNext}
            title="Next version"
            aria-label="Next version"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
