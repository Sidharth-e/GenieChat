"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface ChatLoadingIndicatorProps {
  className?: string;
  displayName?: string;
  modelName?: string;
}

const primaryRing: CSSProperties = {
  background:
    "conic-gradient(from 220deg, transparent 35%, var(--primary) 97%, transparent 100%)",
  maskImage:
    "radial-gradient(transparent 48%, black 51%, black 66%, transparent 69%)",
  WebkitMaskImage:
    "radial-gradient(transparent 48%, black 51%, black 66%, transparent 69%)",
};

const secondaryRing: CSSProperties = {
  background:
    "conic-gradient(from 40deg, transparent 50%, color-mix(in srgb, var(--primary) 45%, transparent) 97%, transparent 100%)",
  maskImage:
    "radial-gradient(transparent 44%, black 47%, black 70%, transparent 73%)",
  WebkitMaskImage:
    "radial-gradient(transparent 44%, black 47%, black 70%, transparent 73%)",
};

export const ChatLoadingIndicator = memo(function ChatLoadingIndicator({
  className,
  displayName = "Assistant",
  modelName,
}: ChatLoadingIndicatorProps) {
  return (
    <div className={cn("px-3 py-4 sm:px-5", className)}>
      <div className="inline-flex items-center gap-3.5 animate-fade-in">
        <span className="sr-only">
          {displayName}
          {modelName ? ` (${modelName})` : ""} is responding
        </span>

        <div className="relative h-10 w-10 shrink-0">
          <div
            className="absolute inset-0 animate-orbit rounded-full"
            style={primaryRing}
          />
          <div
            className="absolute inset-0.5 animate-orbit-reverse rounded-full"
            style={secondaryRing}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-primary animate-center-pulse" />
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[0.75rem] font-semibold tracking-wide text-tertiary/55 animate-label-breathe">
            Thinking
          </span>
          {modelName && (
            <span className="text-[0.625rem] text-tertiary/30 font-medium">
              {modelName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
