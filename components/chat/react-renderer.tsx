"use client";

import * as React from "react";
import { IframePreview } from "@/components/chat/iframe-preview";
import { CodeEditor } from "@/components/ui/code-editor";

interface ReactRendererProps {
  code: string;
  activeTab?: "code" | "preview";
  language?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Renders React code in a live preview (iframe) or as a read-only code view.
 * Uses IframePreview for sandboxed rendering — no external bundler CDN.
 */
export const ReactRenderer = React.memo(function ReactRenderer({
  code,
  activeTab = "preview",
  language = "tsx",
}: ReactRendererProps) {
  const [mounted, setMounted] = React.useState(false);

  const debouncedCode = useDebounce(code, 500);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-full bg-card-bg rounded-xl overflow-hidden flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-secondary/30">
          <div className="animate-pulse text-text-secondary">
            Loading preview...
          </div>
        </div>
      </div>
    );
  }

  if (debouncedCode.length < 50) {
    return (
      <div className="w-full h-full bg-card-bg rounded-xl overflow-hidden flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-secondary/30">
          <div className="animate-pulse text-text-secondary">
            Generating code...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {activeTab === "preview" ? (
        <div className="flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm h-full w-full">
          <IframePreview code={debouncedCode} />
        </div>
      ) : (
        <CodeEditor
          value={debouncedCode}
          onChange={() => {}}
          language={language}
          height="100%"
          readOnly
          className="flex-1 min-h-0 h-full w-full rounded-xl border border-white/5 bg-[#131314] focus-within:border-white/5 focus-within:ring-0"
        />
      )}
    </div>
  );
});
