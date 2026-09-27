"use client";

import * as React from "react";
import { Download, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageBlockProps {
  src: string;
  alt?: string;
}

function ImagePreviewDialog({
  src,
  alt,
  open,
  onClose,
}: {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    if (!open) {
      setScale(1);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-linear-to-b from-black/60 to-transparent">
        <span className="text-sm text-white/80 truncate max-w-[50%]">
          {alt}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="text-xs text-white/60 min-w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Download"
          >
            <Download className="h-5 w-5" />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className="relative z-10 flex items-center justify-center overflow-hidden"
        style={{ width: "90vw", height: "85vh" }}
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full rounded-lg shadow-2xl object-contain transition-transform duration-200"
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

export function ImageBlock({ src, alt = "Generated image" }: ImageBlockProps) {
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  if (!src) return null;

  if (hasError) {
    return (
      <span className="my-4 flex items-center justify-center rounded-xl border border-border bg-tertiary/5 p-8 text-sm text-tertiary/50">
        Failed to load image
      </span>
    );
  }

  return (
    <>
      <span className="inline-flex flex-col items-start">
        <span
          className="inline-flex cursor-pointer"
          onClick={() => setIsPreviewOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={cn(
              "block max-h-[420px] rounded-xl shadow-sm transition-all duration-300 hover:shadow-md",
              isLoaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
          />
          {!isLoaded && (
            <span className="flex h-48 w-64 items-center justify-center rounded-xl bg-tertiary/5">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-tertiary/20 border-t-primary" />
            </span>
          )}
        </span>
        <span className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="rounded-lg p-1.5 text-tertiary/40 transition-colors hover:bg-tertiary/10 hover:text-tertiary"
            title="Expand"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg p-1.5 text-tertiary/40 transition-colors hover:bg-tertiary/10 hover:text-tertiary"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
        </span>
      </span>

      <ImagePreviewDialog
        src={src}
        alt={alt}
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
      />
    </>
  );
}
