"use client";

import * as React from "react";
import { FileText, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentAttachment {
  id: string;
  fileName: string;
  ref: string;
}

interface ImageAttachment {
  id: string;
  fileName: string;
  ref: string;
  base64Data?: string;
}

interface AttachedDocumentsProps {
  documents: DocumentAttachment[];
  alignment?: "left" | "right";
}

interface AttachedImagesProps {
  images: ImageAttachment[];
  alignment?: "left" | "right";
}

const DOCS_COLLAPSE_THRESHOLD = 4;

export function AttachedDocuments({
  documents,
  alignment = "left",
}: AttachedDocumentsProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (!documents || documents.length === 0) return null;

  const shouldCollapse = documents.length > DOCS_COLLAPSE_THRESHOLD;
  const visibleDocs =
    shouldCollapse && !expanded
      ? documents.slice(0, DOCS_COLLAPSE_THRESHOLD - 1)
      : documents;
  const hiddenCount = documents.length - visibleDocs.length;

  return (
    <div
      className={cn(
        "mb-3 w-full",
        alignment === "right" ? "flex justify-end" : "",
      )}
    >
      <div
        className={cn(
          "grid gap-2",
          documents.length === 1
            ? "grid-cols-1 max-w-[280px]"
            : "grid-cols-2 max-w-[480px]",
          alignment === "right" ? "ml-auto" : "",
        )}
      >
        {visibleDocs.map((doc) => (
          <a
            key={doc.id}
            href={`/api/storage/download?ref=${encodeURIComponent(doc.ref)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded-lg border border-tertiary/10 bg-tertiary/5 hover:bg-tertiary/10 transition-colors group/doc min-w-0"
          >
            <div className="h-7 w-7 rounded-md bg-secondary flex items-center justify-center border border-tertiary/10 shrink-0">
              <FileText className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-xs font-medium truncate text-tertiary min-w-0">
              {doc.fileName}
            </span>
            <Download className="h-3.5 w-3.5 text-tertiary/50 shrink-0 opacity-0 group-hover/doc:opacity-100 transition-opacity ml-auto" />
          </a>
        ))}
        {shouldCollapse && !expanded && hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center justify-center gap-1.5 p-2 rounded-lg border border-tertiary/10 bg-tertiary/5 hover:bg-tertiary/10 transition-colors text-xs font-medium text-tertiary/70"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>
      {shouldCollapse && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className={cn(
            "mt-1.5 text-xs text-tertiary/50 hover:text-tertiary/80 transition-colors",
            alignment === "right" ? "ml-auto block" : "",
          )}
        >
          Show less
        </button>
      )}
    </div>
  );
}

function ImagePreviewDialog({
  image,
  open,
  onClose,
}: {
  image: ImageAttachment | null;
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

  if (!open || !image) return null;

  const imageSrc =
    image.base64Data ||
    `/api/storage/download?ref=${encodeURIComponent(image.ref)}`;

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Top Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-linear-to-b from-black/60 to-transparent">
        <span className="text-sm text-white/80 truncate max-w-[50%]">
          {image.fileName}
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
            href={`/api/storage/download?ref=${encodeURIComponent(image.ref)}`}
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

      {/* Image */}
      <div
        className="relative z-10 flex items-center justify-center max-h-[85vh] max-w-[90vw] overflow-auto"
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={image.fileName}
          className="rounded-lg shadow-2xl object-contain transition-transform duration-200"
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

const IMAGES_COLLAPSE_THRESHOLD = 6;

function getImageGridClass(count: number): string {
  if (count === 1) return "grid-cols-1 max-w-[200px]";
  if (count === 2) return "grid-cols-2 max-w-[320px]";
  if (count <= 4) return "grid-cols-2 max-w-[280px]";
  return "grid-cols-3 max-w-[360px]";
}

function getImageSizeClass(count: number): string {
  if (count <= 2) return "h-36 w-full";
  if (count <= 4) return "h-28 w-full";
  return "h-24 w-full";
}

export function AttachedImages({
  images,
  alignment = "left",
}: AttachedImagesProps) {
  const [previewImage, setPreviewImage] =
    React.useState<ImageAttachment | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  if (!images || images.length === 0) return null;

  const shouldCollapse = images.length > IMAGES_COLLAPSE_THRESHOLD;
  const visibleImages =
    shouldCollapse && !expanded
      ? images.slice(0, IMAGES_COLLAPSE_THRESHOLD - 1)
      : images;
  const hiddenCount = images.length - visibleImages.length;
  const displayCount = shouldCollapse && !expanded ? images.length : visibleImages.length;
  const sizeClass = getImageSizeClass(displayCount);

  return (
    <>
      <div
        className={cn(
          "mb-3 w-full",
          alignment === "right" ? "flex justify-end" : "",
        )}
      >
        <div>
          <div
            className={cn(
              "grid gap-1.5",
              getImageGridClass(displayCount),
              alignment === "right" ? "ml-auto" : "",
            )}
          >
            {visibleImages.map((img) => (
              <button
                key={img.id}
                onClick={() => setPreviewImage(img)}
                className="relative group/img rounded-lg overflow-hidden border border-tertiary/10 hover:border-primary/50 transition-colors cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    img.base64Data ||
                    `/api/storage/download?ref=${encodeURIComponent(img.ref)}`
                  }
                  alt={img.fileName}
                  className={cn("object-cover", sizeClass)}
                />
                <div className="absolute inset-0 bg-secondary/0 group-hover/img:bg-secondary/50 transition-colors flex items-center justify-center">
                  <ZoomIn className="h-4 w-4 text-tertiary opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow-lg" />
                </div>
              </button>
            ))}
            {shouldCollapse && !expanded && hiddenCount > 0 && (
              <button
                onClick={() => setExpanded(true)}
                className={cn(
                  "rounded-lg border border-tertiary/10 bg-tertiary/5 hover:bg-tertiary/10 transition-colors flex items-center justify-center text-sm font-medium text-tertiary/70",
                  sizeClass,
                )}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
          {shouldCollapse && expanded && (
            <button
              onClick={() => setExpanded(false)}
              className={cn(
                "mt-1.5 text-xs text-tertiary/50 hover:text-tertiary/80 transition-colors",
                alignment === "right" ? "ml-auto block" : "",
              )}
            >
              Show less
            </button>
          )}
        </div>
      </div>

      <ImagePreviewDialog
        image={previewImage}
        open={!!previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}
