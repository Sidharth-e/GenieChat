"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Download, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  INITIAL_IMAGE_VIEW,
  panImage,
  zoomImageAt,
  type ImageView,
  type Point,
  type Size,
} from "@/lib/image-view";

interface ImageBlockProps {
  src: string;
  alt?: string;
}

/** One step of a wheel notch, and of a trackpad pinch's much smaller deltas. */
const WHEEL_STEP = 0.002;
const PINCH_STEP = 0.008;

/** What a zoom button multiplies by, and so its reciprocal takes back. */
const BUTTON_ZOOM = 1.25;

/** The preview's two boxes, measured from the DOM. */
interface PreviewGeometry {
  /** The frame, as a rect so a client point can be placed in it. */
  rect: DOMRect;
  frame: Size;
  content: Size;
}

/** The distance between the two touches of a pinch. */
function touchSpan(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function touchMidpoint(touches: TouchList): Point {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

/**
 * A pinch as Safari reports it, in a `GestureEvent` the DOM lib does not type.
 * Its `scale` is read against the gesture's start, and `point` is null when the
 * event carries no usable position — which leaves the zoom about the middle
 * rather than at the top-left corner.
 */
function safariGesture(event: Event): { scale: number; point: Point | null } {
  const { scale = 1, clientX = 0, clientY = 0 } = event as unknown as {
    scale?: number;
    clientX?: number;
    clientY?: number;
  };

  return {
    scale: scale > 0 ? scale : 1,
    point: clientX || clientY ? { x: clientX, y: clientY } : null,
  };
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
  const [view, setView] = React.useState<ImageView>(INITIAL_IMAGE_VIEW);
  const [mounted, setMounted] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  // Continuous zoom and drag have to be applied instantly; only the buttons get
  // to animate, or the picture lags one transition behind the pointer.
  const [isGesturing, setIsGesturing] = React.useState(false);

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    from: Point;
    view: ImageView;
  } | null>(null);
  const gestureTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const endDrag = React.useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    setIsGesturing(false);
  }, []);

  React.useEffect(() => {
    if (!open) {
      // A preview closed mid-drag leaves the drag behind it, so the next one
      // starts from unzoomed and undragged rather than from a held button.
      setView(INITIAL_IMAGE_VIEW);
      endDrag();
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
  }, [open, onClose, endDrag]);

  React.useEffect(() => () => clearTimeout(gestureTimerRef.current), []);

  /**
   * Both boxes as they are *laid out* — the frame's rect and the image's
   * untransformed size — because the arithmetic in `lib/image-view.ts` measures
   * the zoom from the picture at rest.
   */
  const measure = React.useCallback((): PreviewGeometry | null => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return null;

    const rect = frame.getBoundingClientRect();
    return {
      rect,
      frame: { width: rect.width, height: rect.height },
      content: { width: image.offsetWidth, height: image.offsetHeight },
    };
  }, []);

  const markGesture = React.useCallback(() => {
    setIsGesturing(true);
    clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => setIsGesturing(false), 200);
  }, []);

  /**
   * Zooms about a point the caller locates, or about the middle when there is
   * no pointer to zoom about — which is what a button press means.
   */
  const zoomBy = React.useCallback(
    (factor: number, pointerAt?: (geometry: PreviewGeometry) => Point) => {
      const geometry = measure();
      if (!geometry) return;

      const centre = {
        x: geometry.frame.width / 2,
        y: geometry.frame.height / 2,
      };
      const pointer = pointerAt ? pointerAt(geometry) : centre;

      setView((current) =>
        zoomImageAt(current, factor, pointer, geometry.frame, geometry.content),
      );
      markGesture();
    },
    [measure, markGesture],
  );

  /**
   * Zoom and drag are gestures, not page operations — but a trackpad pinch
   * reaches Chromium as a `wheel` event with `ctrlKey` set and Safari as a
   * `gesturechange`, and both natively zoom the whole page. React's delegated
   * `wheel` and `touchmove` listeners are registered passive, so the
   * `preventDefault` that claims the gesture has to come from native listeners.
   */
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!open || !surface) return;

    // The page must not zoom behind the overlay wherever the gesture lands, but
    // it is only acted on where the picture is — a pinch over the backdrop
    // would otherwise swing the picture towards a corner nobody pointed at.
    const overPicture = (target: EventTarget | null) =>
      target !== null && frameRef.current?.contains(target as Node) === true;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!overPicture(e.target)) return;

      // Firefox reports a notch in lines rather than pixels, so a `deltaY` of 3
      // would otherwise be three pixels' worth of zoom.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      zoomBy(1 - delta * (e.ctrlKey ? PINCH_STEP : WHEEL_STEP), (geometry) => ({
        x: e.clientX - geometry.rect.left,
        y: e.clientY - geometry.rect.top,
      }));
    };

    // Safari's own pinch, whose `scale` is read against the gesture's start.
    let lastGestureScale: number | null = null;
    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      lastGestureScale = null;
    };
    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      if (!overPicture(e.target)) return;

      const { scale, point } = safariGesture(e);
      const factor = lastGestureScale === null ? 1 : scale / lastGestureScale;
      lastGestureScale = scale;

      zoomBy(
        factor,
        point
          ? (geometry) => ({
              x: point.x - geometry.rect.left,
              y: point.y - geometry.rect.top,
            })
          : undefined,
      );
    };

    let pinchSpan: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      // A second finger starts a pinch, so a drag already under way has to give
      // the gesture up rather than translate while the span is changing.
      if (e.touches.length === 2) {
        endDrag();
        pinchSpan = touchSpan(e.touches);
        return;
      }
      pinchSpan = null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (pinchSpan === null || e.touches.length !== 2) return;
      e.preventDefault();

      const span = touchSpan(e.touches);
      const factor = span / pinchSpan;
      pinchSpan = span;
      const midpoint = touchMidpoint(e.touches);

      zoomBy(factor, (geometry) => ({
        x: midpoint.x - geometry.rect.left,
        y: midpoint.y - geometry.rect.top,
      }));
    };
    const handleTouchEnd = () => {
      pinchSpan = null;
    };

    surface.addEventListener("wheel", handleWheel, { passive: false });
    surface.addEventListener("gesturestart", handleGestureStart);
    surface.addEventListener("gesturechange", handleGestureChange);
    surface.addEventListener("touchstart", handleTouchStart);
    surface.addEventListener("touchmove", handleTouchMove, { passive: false });
    surface.addEventListener("touchend", handleTouchEnd);

    return () => {
      surface.removeEventListener("wheel", handleWheel);
      surface.removeEventListener("gesturestart", handleGestureStart);
      surface.removeEventListener("gesturechange", handleGestureChange);
      surface.removeEventListener("touchstart", handleTouchStart);
      surface.removeEventListener("touchmove", handleTouchMove);
      surface.removeEventListener("touchend", handleTouchEnd);
    };
  }, [open, zoomBy, endDrag]);

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    // A second finger belongs to a pinch, not to a drag.
    if (!e.isPrimary) return;

    dragRef.current = {
      pointerId: e.pointerId,
      from: { x: e.clientX, y: e.clientY },
      view,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    clearTimeout(gestureTimerRef.current);
    setIsDragging(true);
    setIsGesturing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const geometry = measure();
    if (!geometry) return;

    e.preventDefault();
    // Measured from where the drag began rather than from the last move, so a
    // drag that runs into the limit and comes back returns to where it started.
    setView(
      panImage(
        drag.view,
        { x: e.clientX - drag.from.x, y: e.clientY - drag.from.y },
        geometry.frame,
        geometry.content,
      ),
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    endDrag();
  };

  if (!open || !mounted) return null;

  const canDrag = view.scale > 1;

  // Portalled to `body`, not rendered in place: this dialog is reached from an
  // image inside a message, and that image sits in a `<p>`. A `<div>` cannot be
  // a descendant of one, so rendering it here is invalid HTML that React
  // reports as a hydration error. `mounted` keeps the portal off the server
  // render, where `document` does not exist.
  return createPortal(
    <div
      ref={surfaceRef}
      className="fixed inset-0 z-50 flex touch-none items-center justify-center"
    >
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
            onClick={() => zoomBy(1 / BUTTON_ZOOM)}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="text-xs text-white/60 min-w-12 text-center">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            onClick={() => zoomBy(BUTTON_ZOOM)}
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
        ref={frameRef}
        className="relative z-10 flex items-center justify-center overflow-hidden"
        style={{ width: "90vw", height: "85vh" }}
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          draggable={false}
          className={cn(
            "max-h-full max-w-full rounded-lg shadow-2xl object-contain select-none",
            !isGesturing && "transition-transform duration-200",
            canDrag && (isDragging ? "cursor-grabbing" : "cursor-grab"),
          )}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>
    </div>,
    document.body,
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
