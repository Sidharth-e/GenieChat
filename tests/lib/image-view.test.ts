import { describe, expect, it } from "vitest";

import {
  INITIAL_IMAGE_VIEW,
  MAX_IMAGE_ZOOM,
  MIN_IMAGE_ZOOM,
  panImage,
  zoomImageAt,
  type ImageView,
  type Point,
  type Size,
} from "@/lib/image-view";

/** Factories rather than inline literals, so a new field reaches every case. */
function view(overrides: Partial<ImageView> = {}): ImageView {
  return { scale: 1, x: 0, y: 0, ...overrides };
}

function size(width: number, height: number): Size {
  return { width, height };
}

function point(x: number, y: number): Point {
  return { x, y };
}

/** A frame and a picture that fills it exactly, so any zoom can be dragged. */
const FRAME = size(1000, 800);
const FILLING = size(1000, 800);
/** A picture with room to spare inside the frame. */
const SMALL = size(500, 400);

/** Where an untransformed point of the picture ends up in the frame. */
function project(view: ImageView, point: Point, frame: Size): Point {
  const centreX = frame.width / 2;
  const centreY = frame.height / 2;
  return {
    x: centreX + view.x + view.scale * (point.x - centreX),
    y: centreY + view.y + view.scale * (point.y - centreY),
  };
}

describe("zoomImageAt", () => {
  it("scales about the pointer, leaving what it points at in place", () => {
    const before = view();
    const pointer = point(900, 700);
    const after = zoomImageAt(before, 2, pointer, FRAME, FILLING);

    expect(after.scale).toBe(2);
    // The picture point that sat under the pointer still sits under it.
    const picturePoint = point(900, 700);
    expect(project(after, picturePoint, FRAME)).toEqual(pointer);
  });

  it("moves the picture towards the pointer it zoomed about", () => {
    const after = zoomImageAt(view(), 2, point(900, 700), FRAME, FILLING);

    expect(after.x).toBe(-400);
    expect(after.y).toBe(-300);
  });

  it("stays centred when zoomed about the middle", () => {
    const centre = point(FRAME.width / 2, FRAME.height / 2);
    const after = zoomImageAt(view({ x: 20, y: 10 }), 2, centre, FRAME, FILLING);

    expect(after.x).toBe(40);
    expect(after.y).toBe(20);
  });

  it("moves the picture so the corner it zoomed about stays put", () => {
    // Zooming about the frame's top-left pushes the picture down and to the
    // right, which is what holds that corner under the pointer.
    const after = zoomImageAt(view(), 2, point(0, 0), FRAME, FILLING);

    expect(after.x).toBe(500);
    expect(after.y).toBe(400);
    expect(project(after, point(0, 0), FRAME)).toEqual(point(0, 0));
  });

  it("stops at the frame's edge when a zoom asks for more than that", () => {
    // The same zoom about a point outside the frame would want (900, 700).
    const after = zoomImageAt(view(), 2, point(-400, -300), FRAME, FILLING);

    expect(after.x).toBe(500);
    expect(after.y).toBe(400);
  });

  it("holds the zoom limits", () => {
    const zoomedIn = view({ scale: MAX_IMAGE_ZOOM });
    const zoomedOut = view({ scale: MIN_IMAGE_ZOOM });

    expect(zoomImageAt(zoomedIn, 2, point(0, 0), FRAME, FILLING)).toBe(zoomedIn);
    expect(zoomImageAt(zoomedOut, 0.5, point(0, 0), FRAME, FILLING)).toBe(
      zoomedOut,
    );
  });

  it("leaves the view untouched once it has run out of zoom", () => {
    // Not merely the same scale: an unchanged view is what keeps a pinch at the
    // limit from sliding the picture towards a pointer it cannot follow.
    const atLimit = view({ scale: MAX_IMAGE_ZOOM, x: 40, y: -20 });

    expect(zoomImageAt(atLimit, 1.1, point(10, 10), FRAME, FILLING)).toEqual(
      atLimit,
    );
  });

  it("recentres a picture that fits the frame", () => {
    const panned = view({ scale: 1, x: 300, y: 300 });
    const after = zoomImageAt(panned, 1.25, point(0, 0), FRAME, SMALL);

    expect(after.scale).toBe(1.25);
    expect(after.x).toBe(0);
    expect(after.y).toBe(0);
  });
});

describe("panImage", () => {
  it("moves the picture by the drag", () => {
    const after = panImage(
      view({ scale: 2 }),
      point(120, -60),
      FRAME,
      FILLING,
    );

    expect(after).toEqual(view({ scale: 2, x: 120, y: -60 }));
  });

  it("stops the picture at the frame's edge", () => {
    const after = panImage(
      view({ scale: 2 }),
      point(10_000, 10_000),
      FRAME,
      FILLING,
    );

    expect(after.x).toBe(500);
    expect(after.y).toBe(400);
  });

  it("cannot drag a picture that is not zoomed in at all", () => {
    const after = panImage(view(), point(200, 200), FRAME, FILLING);

    expect(after.x).toBe(0);
    expect(after.y).toBe(0);
  });

  it("cannot drag a picture that still fits inside the frame", () => {
    // 500×400 at this zoom is 750×600, which leaves it short of the frame on
    // both axes — so it stays centred however far it is dragged.
    const after = panImage(view({ scale: 1.5 }), point(50, 50), FRAME, SMALL);

    expect(after.x).toBe(0);
    expect(after.y).toBe(0);
  });

  it("keeps the scale it was given", () => {
    const after = panImage(view({ scale: 2.5 }), point(10, 10), FRAME, FILLING);

    expect(after.scale).toBe(2.5);
  });
});

describe("INITIAL_IMAGE_VIEW", () => {
  it("is unzoomed and centred", () => {
    expect(INITIAL_IMAGE_VIEW).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
