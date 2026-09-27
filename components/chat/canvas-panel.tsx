"use client";

import { useCanvasStore } from "@/lib/stores/canvas-store";
import {
  X,
  Undo2,
  Redo2,
  Fullscreen,
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactRenderer } from "@/components/chat/react-renderer";
import { CodeEditor } from "@/components/ui/code-editor";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useParams } from "next/navigation";

const PANEL_MIN_WIDTH_PCT = 30;
const PANEL_MAX_WIDTH_PCT = 75;
const PANEL_DEFAULT_WIDTH_PCT = 50;

export function CanvasPanel() {
  const {
    isOpen,
    versions,
    activeIndex,
    fetchVersions,
    closeCanvas,
    clearCanvas,
    nextVersion,
    prevVersion,
  } = useCanvasStore();
  const [activeTab, setActiveTab] = React.useState<"code" | "preview">(
    "preview",
  );
  const [panelWidthPct, setPanelWidthPct] = React.useState(
    PANEL_DEFAULT_WIDTH_PCT,
  );
  const isDragging = React.useRef(false);
  const params = useParams();
  const threadId = params?.id as string;

  const handleResizeMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const pct =
        ((window.innerWidth - moveEvent.clientX) / window.innerWidth) * 100;
      setPanelWidthPct(
        Math.min(PANEL_MAX_WIDTH_PCT, Math.max(PANEL_MIN_WIDTH_PCT, pct)),
      );
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  // Fetch history and extract code blocks when threadId changes
  React.useEffect(() => {
    if (!threadId) {
      clearCanvas();
      return;
    }
    if (!isOpen) return;

    void fetchVersions(threadId);
  }, [clearCanvas, fetchVersions, isOpen, threadId]);

  const handleFullscreen = () => {
    if (threadId) {
      window.open(`/preview/${threadId}?version=${activeIndex}`, "_blank");
    }
  };

  if (!isOpen || versions.length === 0 || activeIndex < 0) return null;

  const activeVersion = versions[activeIndex];
  const { code, language } = activeVersion;

  return (
    <div
      className="w-full h-full flex flex-col bg-bg-sidebar shrink-0 z-40 absolute inset-0 lg:relative lg:inset-auto"
      style={{
        width: `${panelWidthPct}%`,
        minWidth: `${PANEL_MIN_WIDTH_PCT}vw`,
        maxWidth: `${PANEL_MAX_WIDTH_PCT}vw`,
      }}
    >
      {/* Resize handle — wider hit area, always-visible grip icon */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="hidden lg:flex absolute left-0 top-0 h-full w-3 cursor-col-resize z-50 group items-center justify-center"
      >
        <GripVertical className="w-3 h-6 text-text-secondary/30 group-hover:text-primary transition-colors duration-150" />
      </div>
      {/* Top Floating Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-3 p-3 mt-2 mx-3 bg-background rounded-2xl border border-card-border shadow-lg relative z-20">
        {/* Left Actions (Version Control & Cloud) */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 min-w-0">
          <div className="flex items-center gap-0.5 bg-hover-bg rounded-lg p-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={prevVersion}
              disabled={activeIndex === 0}
              className="h-7 w-7 rounded-md text-text-secondary hover:text-foreground hover:bg-active-bg disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-xs font-medium text-text-secondary min-w-[32px] text-center">
              v{activeIndex + 1}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={nextVersion}
              disabled={activeIndex === versions.length - 1}
              className="h-7 w-7 rounded-md text-text-secondary hover:text-foreground hover:bg-active-bg disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Undo/Redo are hidden on very small screens to save space */}
          <div className="hidden xl:flex items-center gap-0.5 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-text-secondary hover:text-foreground hover:bg-active-bg"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-text-secondary hover:text-foreground hover:bg-active-bg"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Center Actions (View Toggle) */}
        <div className="flex items-center justify-center flex-1 min-w-[150px]">
          <div className="flex items-center p-0.5 bg-hover-bg rounded-full border border-card-border">
            <button
              onClick={() => setActiveTab("code")}
              className={cn(
                "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200",
                activeTab === "code"
                  ? "bg-primary text-secondary shadow-sm"
                  : "text-text-secondary hover:text-foreground hover:bg-active-bg",
              )}
            >
              Code
            </button>
            <button
              onClick={() => setActiveTab("preview")}
              className={cn(
                "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200",
                activeTab === "preview"
                  ? "bg-primary text-secondary shadow-sm"
                  : "text-text-secondary hover:text-foreground hover:bg-active-bg",
              )}
            >
              Preview
            </button>
          </div>
        </div>

        {/* Right Actions (Share, Fullscreen, Close) */}
        <div className="flex items-center gap-2 pr-1 text-text-secondary justify-end shrink-0">
          <div className="w-px h-4 bg-tertiary/10 mx-1 hidden sm:block" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFullscreen}
            title="Full Screen Preview"
            className="h-8 w-8 rounded-full hover:bg-active-bg hover:text-foreground"
          >
            <Fullscreen className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeCanvas}
            className="h-8 w-8 rounded-full hover:bg-active-bg hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 overflow-hidden relative m-3 mt-4 rounded-xl border border-card-border bg-background flex flex-col min-h-0 shadow-xl">
        {language === "react-canvas" ? (
          <div className="flex-1 w-full h-full min-h-0 relative renderer-container">
            <ReactRenderer code={code} activeTab={activeTab} language="tsx" />
          </div>
        ) : (
          <CodeEditor
            value={code}
            onChange={() => {}}
            language={language || "javascript"}
            height="100%"
            readOnly
            className="flex-1 w-full h-full min-h-0 rounded-none border-0 bg-transparent focus-within:border-0 focus-within:ring-0"
          />
        )}
      </div>
    </div>
  );
}
