"use client";

import { logger } from "@/lib/logger";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  MarkdownRenderer,
  messageContentStyles,
} from "@/components/common/markdown-renderer";
import { Loader2, X, Download, Share2, Sparkles, RefreshCw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DeepResearchReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  reportRef: string;
}

export function DeepResearchReportModal({
  open,
  onOpenChange,
  title,
  reportRef,
}: DeepResearchReportModalProps) {
  const [content, setContent] = React.useState<string>("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const readingTime = React.useMemo(() => {
    if (!content) return null;
    const words = content.trim().split(/\s+/).length;
    const mins = Math.ceil(words / 200);
    return mins;
  }, [content]);

  const loadReport = React.useCallback(() => {
    if (!reportRef) return;
    setIsLoading(true);
    setError(null);
    fetch(`/api/deep-research/report?ref=${encodeURIComponent(reportRef)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load report");
        return res.text();
      })
      .then((text) => {
        setContent(text);
      })
      .catch((err) => {
        logger.error("Error loading report:", err);
        setError("Failed to load report content");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [reportRef]);

  React.useEffect(() => {
    if (open && reportRef && !content) {
      loadReport();
    }
  }, [open, reportRef, content, loadReport]);

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: content?.substring(0, 200) + "...",
        });
      } catch (err) {
        logger.error("Share failed:", err);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col gap-0 bg-modal-bg border border-modal-border/40">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-medium text-tertiary truncate max-w-[400px]">
                {title}
              </h2>
              {readingTime && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <Clock className="h-3 w-3" />
                  {readingTime} min read
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShare}
              className="text-tertiary/70 hover:text-tertiary"
            >
              <Share2 className="h-4 w-4 mr-1.5" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={!content}
              className="text-tertiary/70 hover:text-tertiary"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 text-tertiary/70 hover:text-tertiary"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-10">
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-tertiary/60">Loading report...</p>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <X className="h-6 w-6 text-destructive" />
                </div>
                <p className="text-sm text-destructive">{error}</p>
                <button
                  onClick={loadReport}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/30"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            )}

            {!isLoading && !error && content && (
              <article
                className={cn(
                  messageContentStyles,
                  "research-report",
                  // Enhanced typography for research reports
                  "prose-headings:tracking-tight",
                  "prose-h1:text-3xl prose-h1:font-bold prose-h1:mb-6 prose-h1:mt-0 prose-h1:leading-tight",
                  "prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-4 prose-h2:mt-10 prose-h2:pb-2 prose-h2:border-b prose-h2:border-border",
                  "prose-h3:text-lg prose-h3:font-semibold prose-h3:mb-3 prose-h3:mt-8",
                  "prose-h4:text-base prose-h4:font-medium prose-h4:mb-2 prose-h4:mt-6",
                  "prose-p:text-[15px] prose-p:leading-relaxed prose-p:my-4 prose-p:text-tertiary/90",
                  "prose-li:text-[15px] prose-li:leading-relaxed prose-li:text-tertiary/90",
                  "prose-strong:text-tertiary prose-strong:font-semibold",
                  "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
                  "prose-blockquote:border-l-primary/40 prose-blockquote:bg-secondary/30 prose-blockquote:py-2 prose-blockquote:pr-4 prose-blockquote:rounded-r-lg",
                  "prose-hr:my-8 prose-hr:border-border"
                )}
              >
                <MarkdownRenderer content={content} />
              </article>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
