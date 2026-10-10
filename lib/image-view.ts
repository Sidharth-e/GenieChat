/**
 * The pan and zoom arithmetic behind the image preview.
 *
 * Held apart from the component and unit-tested: what a pinch should leave
 * under the pointer, and how far the picture may be dragged, are the decisions
 * worth pinning down, and neither needs a browser to state.
 *
 * The picture is taken to be centred in its frame, which is where the preview
 * puts it. A view is a scale about that centre plus a translation, so the whole
 * thing is the one CSS transform `translate(x, y) scale(scale)`.
 */

export interface ImageView {
  /** The zoom, from {@link MIN_IMAGE_ZOOM} to {@link MAX_IMAGE_ZOOM}. */
  scale: number;
  /** The translation, in the frame's pixels. */
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_IMAGE_ZOOM = 0.5;
export const MAX_IMAGE_ZOOM = 3;

/** Unzoomed and centred — what closing the preview resets to. */
export const INITIAL_IMAGE_VIEW: ImageView = { scale: 1, x: 0, y: 0 };

export function clampImageZoom(scale: number): number {
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, scale));
}

/**
 * How far the picture may sit from the middle, per axis.
 *
 * Zero while the scaled picture still fits inside the frame, which is what
 * recentres it as a zoom-out brings it back to fitting: there is nowhere for it
 * to sit but the middle. Past that it may be dragged until its own edge meets
 * the frame's, so it can never be pushed out of sight.
 */
function offsetLimit(scaled: number, frame: number): number {
  return Math.max(0, (scaled - frame) / 2);
}

function clampView(view: ImageView, frame: Size, content: Size): ImageView {
  const limitX = offsetLimit(content.width * view.scale, frame.width);
  const limitY = offsetLimit(content.height * view.scale, frame.height);

  return {
    scale: view.scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

/**
 * Zooms about a point, so whatever sits under the pointer stays under it.
 *
 * `pointer` is measured from the frame's top-left, like `x`/`y`. At a zoom
 * limit this returns the view untouched rather than sliding the picture towards
 * a pointer it can no longer follow.
 */
export function zoomImageAt(
  view: ImageView,
  factor: number,
  pointer: Point,
  frame: Size,
  content: Size,
): ImageView {
  const scale = clampImageZoom(view.scale * factor);
  if (scale === view.scale) return view;

  const centreX = frame.width / 2;
  const centreY = frame.height / 2;
  const ratio = scale / view.scale;

  return clampView(
    {
      scale,
      x: pointer.x - centreX - ratio * (pointer.x - centreX - view.x),
      y: pointer.y - centreY - ratio * (pointer.y - centreY - view.y),
    },
    frame,
    content,
  );
}

/** Drags the picture, bounded by the same limit a zoom is. */
export function panImage(
  view: ImageView,
  delta: Point,
  frame: Size,
  content: Size,
): ImageView {
  return clampView(
    { scale: view.scale, x: view.x + delta.x, y: view.y + delta.y },
    frame,
    content,
  );
}
