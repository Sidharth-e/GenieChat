"use client";

/**
 * The drawn graph: a canvas, a camera, and a frame loop over the layout.
 *
 * The canvas is the reason this is a separate component from the tab's chrome:
 * every frame paints straight into a 2D context, so nothing here goes through
 * React. The camera, the simulation and the animation frame live in refs, and
 * the frame loop is driven by `requestAnimationFrame` rather than by a render —
 * which is what keeps a few thousand nodes off the render path. React re-renders
 * this component only when a prop changes, and a frame needs no prop to change.
 *
 * It owns the drawing and the pointing, and nothing else: selection, the detail
 * card and the keyboard order belong to the chrome around it, which is also
 * where the accessible reading of this picture lives. A canvas has no DOM to
 * read, so the `role="img"` label and the sibling live region are the whole of
 * what a screen reader gets from this file.
 */
import * as React from "react";
import {
  MEMORY_GRAPH_ALPHA_MIN,
  MEMORY_GRAPH_HOVER_PADDING,
  MEMORY_GRAPH_LABEL_MIN_DEGREE,
  MEMORY_GRAPH_LABEL_ZOOM,
  MEMORY_GRAPH_MAX_ZOOM,
  MEMORY_GRAPH_MIN_ZOOM,
} from "@/constants/memory";
import {
  MEMORY_GRAPH_EDGE_STYLE,
  MEMORY_GRAPH_NODE_TOKEN,
  matchMemoryGraphNodes,
  nodeRadius,
  type MemoryGraphNodeKind,
  type MemoryGraphView,
  type MemoryGraphViewNode,
} from "@/lib/memory/graph-view";
import {
  createMemoryLayout,
  seedMemoryLayout,
  type MemoryLayoutSimulation,
} from "@/lib/memory/graph-layout";
import { MEMORY_GRAPH_LABEL_TOKEN } from "@/hooks/use-memory-graph-palette";
import { cn } from "@/lib/utils";

const TAU = Math.PI * 2;
const LABEL_FONT_SIZE = 11;
/** The label offset below a node, in screen pixels. */
const LABEL_OFFSET = 4;
/** Beyond this many characters a fact's label is clamped for drawing. */
const FACT_LABEL_MAX_CHARS = 42;
/** A drag shorter than this is a click, not a drag. */
const CLICK_SLOP = 4;
/** The wheel-to-zoom constant. Small, because a trackpad reports many events. */
const ZOOM_PER_DELTA = 0.0015;

interface Camera {
  x: number;
  y: number;
  k: number;
}

type DragState =
  | { mode: "pan"; startX: number; startY: number; cameraX: number; cameraY: number; moved: number }
  | { mode: "node"; id: string; startX: number; startY: number; moved: number };

interface MemoryGraphCanvasProps {
  view: MemoryGraphView;
  /** The raw search text. A blank query means no search is active. */
  query: string;
  palette: Record<string, string>;
  hoveredId: string | null;
  selectedId: string | null;
  focusedId: string | null;
  ariaLabel: string;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLCanvasElement>;
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function truncateLabel(node: MemoryGraphViewNode): string {
  if (node.kind !== "fact") return node.label;
  return node.label.length > FACT_LABEL_MAX_CHARS
    ? `${node.label.slice(0, FACT_LABEL_MAX_CHARS - 1)}…`
    : node.label;
}

/**
 * Kind is carried by shape as well as colour, so the picture still reads when
 * the palette does not: the anchor is a ring, a fact a rounded square, an entity
 * a circle, a predicate a diamond, a value a smaller circle.
 *
 * The anchor is the one outline shape, because it is the one node the reader is
 * meant to locate first — a hollow ring at the centre of a disc of filled marks
 * is unmistakable, and it stays legible with a fact drawn over it.
 */
function drawNodeShape(
  ctx: CanvasRenderingContext2D,
  kind: MemoryGraphNodeKind,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  if (kind === "user") {
    // Two arcs wound in opposite directions punch the hole: an even-odd fill
    // would also hollow the ring out where a fact overlaps it.
    ctx.arc(x, y, radius, 0, TAU);
    ctx.moveTo(x + radius * 0.5, y);
    ctx.arc(x, y, radius * 0.5, 0, TAU, true);
  } else if (kind === "fact") {
    const side = radius * 2;
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x - radius, y - radius, side, side, radius * 0.35);
    } else {
      ctx.rect(x - radius, y - radius, side, side);
    }
  } else if (kind === "predicate") {
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, radius, 0, TAU);
  }
  ctx.closePath();
}

export function MemoryGraphCanvas({
  view,
  query,
  palette,
  hoveredId,
  selectedId,
  focusedId,
  ariaLabel,
  onHover,
  onSelect,
  onKeyDown,
  className,
}: MemoryGraphCanvasProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const sizeRef = React.useRef(size);
  sizeRef.current = size;

  const cameraRef = React.useRef<Camera>({ x: 0, y: 0, k: 1 });
  const simulationRef = React.useRef<MemoryLayoutSimulation | null>(null);
  // Built once per simulation, not per frame: the layout nodes are mutated in
  // place, so the map holds live references and never goes stale.
  const positionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map());
  const frameRef = React.useRef<number | null>(null);
  const runningRef = React.useRef(false);
  const dragRef = React.useRef<DragState | null>(null);

  const nodesById = React.useMemo(() => {
    const map = new Map<string, MemoryGraphViewNode>();
    for (const node of view.nodes) map.set(node.id, node);
    return map;
  }, [view]);
  const nodesByIdRef = React.useRef(nodesById);
  nodesByIdRef.current = nodesById;

  // Who is adjacent to whom, for the hover dimming. Built once per view.
  const adjacency = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      const set = map.get(a) ?? new Set<string>();
      set.add(b);
      map.set(a, set);
    };
    for (const edge of view.edges) {
      link(edge.source, edge.target);
      link(edge.target, edge.source);
    }
    return map;
  }, [view]);
  const adjacencyRef = React.useRef(adjacency);
  adjacencyRef.current = adjacency;

  // Everything the paint pass reads, behind one ref so the loop never closes
  // over a stale render.
  const paintStateRef = React.useRef({ view, query, palette, hoveredId, selectedId, focusedId });
  paintStateRef.current = { view, query, palette, hoveredId, selectedId, focusedId };

  const colourOf = React.useCallback((token: string, fallback = "#8a8a8a") => {
    return paintStateRef.current.palette[token] || fallback;
  }, []);

  /** One frame: edges, then nodes by shape, then labels, all under the camera. */
  const paint = React.useCallback(() => {
    const canvas = canvasRef.current;
    const simulation = simulationRef.current;
    if (!canvas || !simulation) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    const camera = cameraRef.current;
    const { view: paintedView, query: paintedQuery, hoveredId: hover, selectedId: selected, focusedId: focused } =
      paintStateRef.current;

    // What stays at full strength. A search and a pointer both dim, and they
    // add rather than override: whichever is active narrows the lit set.
    const lit = new Set<string>();
    let dimming = false;
    const matches = matchMemoryGraphNodes(paintedView, paintedQuery);
    if (matches) {
      dimming = true;
      for (const id of matches) lit.add(id);
    }
    const activeId = hover ?? focused ?? selected;
    if (activeId) {
      dimming = true;
      lit.add(activeId);
      for (const neighbour of adjacencyRef.current.get(activeId) ?? []) lit.add(neighbour);
    }
    const alphaOf = (id: string) => (dimming && !lit.has(id) ? 0.12 : 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.k, camera.k);

    const positions = positionsRef.current;

    // Edges. Width and dash are divided by the zoom so a line keeps its weight
    // on screen however far out the reader has pulled; the dashes are numbers
    // because `setLineDash` takes numbers, not the SVG strings.
    ctx.lineCap = "round";
    for (const edge of paintedView.edges) {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) continue;
      const style = MEMORY_GRAPH_EDGE_STYLE[edge.kind];
      ctx.globalAlpha = Math.min(alphaOf(edge.source), alphaOf(edge.target)) * 0.6;
      ctx.strokeStyle = colourOf(style.token);
      ctx.lineWidth = style.width / camera.k;
      ctx.setLineDash(style.dash ? style.dash.map((dash) => dash / camera.k) : []);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes. Radii are world units and so scale with the zoom — that is what
    // zooming in buys: a hub is bigger, not just nearer.
    for (const node of simulation.nodes) {
      const drawn = nodesByIdRef.current.get(node.id);
      if (!drawn) continue;
      ctx.globalAlpha = alphaOf(node.id);
      const fill = colourOf(MEMORY_GRAPH_NODE_TOKEN[drawn.kind]);
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1 / camera.k;
      drawNodeShape(ctx, drawn.kind, node.x, node.y, node.radius);
      ctx.fill();
      ctx.stroke();

      if (node.id === selected || node.id === focused || node.id === hover) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colourOf(MEMORY_GRAPH_LABEL_TOKEN);
        ctx.lineWidth = 2 / camera.k;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + MEMORY_GRAPH_HOVER_PADDING / camera.k, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.restore();

    // Labels last, in screen space, so the text is crisp at every zoom: the
    // picture is dots until the reader zooms in or points at something.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${LABEL_FONT_SIZE}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = colourOf(MEMORY_GRAPH_LABEL_TOKEN);
    for (const node of simulation.nodes) {
      const drawn = nodesByIdRef.current.get(node.id);
      if (!drawn) continue;
      const labelled =
        node.id === hover ||
        node.id === focused ||
        node.id === selected ||
        drawn.degree >= MEMORY_GRAPH_LABEL_MIN_DEGREE ||
        camera.k >= MEMORY_GRAPH_LABEL_ZOOM;
      if (!labelled) continue;
      const screenX = node.x * camera.k + camera.x;
      const screenY = node.y * camera.k + camera.y + node.radius * camera.k + LABEL_OFFSET;
      if (screenX < -80 || screenX > width + 80 || screenY < -20 || screenY > height + 20) continue;
      ctx.globalAlpha = alphaOf(node.id);
      ctx.fillText(truncateLabel(drawn), screenX, screenY);
    }
    ctx.globalAlpha = 1;
  }, [colourOf]);

  const runLoop = React.useCallback(() => {
    const simulation = simulationRef.current;
    if (!simulation) {
      runningRef.current = false;
      frameRef.current = null;
      return;
    }
    if (simulation.alpha() > MEMORY_GRAPH_ALPHA_MIN) {
      simulation.tick(1);
      paint();
      frameRef.current = requestAnimationFrame(runLoop);
    } else {
      // One last paint at the settled positions, then stop asking for frames:
      // a simulation left running on thousands of nodes cooks a battery.
      paint();
      runningRef.current = false;
      frameRef.current = null;
    }
  }, [paint]);

  const cancelFrame = React.useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startLoop = React.useCallback(() => {
    cancelFrame();
    runningRef.current = true;
    frameRef.current = requestAnimationFrame(runLoop);
  }, [cancelFrame, runLoop]);

  /** Repaint without waking the simulation — hover, selection, palette change. */
  const schedulePaint = React.useCallback(() => {
    if (runningRef.current || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  }, [paint]);

  // The container decides the drawing's size.
  React.useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The backing store follows the size and the device pixel ratio, or the
  // picture is drawn at CSS resolution and looks soft on a retina display.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    schedulePaint();
  }, [size, schedulePaint]);

  // One simulation per view and size. A new read lays the picture out again from
  // a fresh seed, which is also what re-centres it after a resize.
  React.useEffect(() => {
    if (!size.width || !size.height) return;
    const seeded = seedMemoryLayout(
      view.nodes.map((node) => ({ id: node.id, radius: nodeRadius(node.kind, node.degree) })),
      size.width,
      size.height,
    );
    const simulation = createMemoryLayout(seeded, view.edges, {
      width: size.width,
      height: size.height,
    });
    simulationRef.current = simulation;

    // The anchor is pinned at the centre rather than left to the simulation:
    // every fact hangs off it, so a free anchor would be pulled to wherever the
    // facts settle and the picture would read as a cloud with no centre. The
    // layout's own `forceCenter` translates pinned nodes too, but the anchor is
    // the centroid of its neighbours, so the mean it subtracts is the centre it
    // was pinned to and the drift is nil.
    const anchor = view.nodes.find((node) => node.kind === "user");
    if (anchor) simulation.pin(anchor.id, size.width / 2, size.height / 2);

    positionsRef.current = new Map(seeded.map((node) => [node.id, node]));
    cameraRef.current = { x: 0, y: 0, k: 1 };
    startLoop();

    return () => {
      cancelFrame();
      runningRef.current = false;
      simulationRef.current = null;
      positionsRef.current = new Map();
    };
  }, [view, size.width, size.height, startLoop, cancelFrame]);

  // A theme switch, a selection or a hover changes only the colours and the
  // emphasis, so the settled picture is repainted rather than re-laid out.
  React.useEffect(() => {
    schedulePaint();
  }, [palette, hoveredId, selectedId, focusedId, query, schedulePaint]);

  // The wheel listener is attached by hand because React's is passive, and a
  // passive listener cannot stop the page from scrolling under the zoom.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const camera = cameraRef.current;
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const next = clamp(
        camera.k * Math.exp(-event.deltaY * ZOOM_PER_DELTA),
        MEMORY_GRAPH_MIN_ZOOM,
        MEMORY_GRAPH_MAX_ZOOM,
      );
      if (next === camera.k) return;
      // Anchor the zoom on the pointer: the world point under it stays put.
      const worldX = (pointerX - camera.x) / camera.k;
      const worldY = (pointerY - camera.y) / camera.k;
      cameraRef.current = { k: next, x: pointerX - worldX * next, y: pointerY - worldY * next };
      schedulePaint();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [schedulePaint]);

  /** Screen point to world point, and back for the drag maths. */
  const toWorld = React.useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, screenX: 0, screenY: 0 };
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return {
      x: (screenX - camera.x) / camera.k,
      y: (screenY - camera.y) / camera.k,
      screenX,
      screenY,
    };
  }, []);

  /** The nearest node within its own radius plus the hover padding, or null. */
  const hitTest = React.useCallback(
    (worldX: number, worldY: number): string | null => {
      const simulation = simulationRef.current;
      if (!simulation) return null;
      // The padding is divided by the zoom so the tolerance is the same number
      // of screen pixels however far out the reader has pulled.
      const padding = MEMORY_GRAPH_HOVER_PADDING / cameraRef.current.k;
      let nearest: string | null = null;
      let nearestDistance = Infinity;
      for (const node of simulation.nodes) {
        const distance = Math.hypot(node.x - worldX, node.y - worldY);
        if (distance <= node.radius + padding && distance < nearestDistance) {
          nearestDistance = distance;
          nearest = node.id;
        }
      }
      return nearest;
    },
    [],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toWorld(event.clientX, event.clientY);
    const hit = hitTest(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (hit) {
      dragRef.current = {
        mode: "node",
        id: hit,
        startX: point.screenX,
        startY: point.screenY,
        moved: 0,
      };
      simulationRef.current?.pin(hit, point.x, point.y);
      simulationRef.current?.reheat();
      startLoop();
      return;
    }
    dragRef.current = {
      mode: "pan",
      startX: point.screenX,
      startY: point.screenY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
      moved: 0,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const point = toWorld(event.clientX, event.clientY);

    if (drag?.mode === "node") {
      drag.moved = Math.max(
        drag.moved,
        Math.hypot(point.screenX - drag.startX, point.screenY - drag.startY),
      );
      simulationRef.current?.pin(drag.id, point.x, point.y);
      simulationRef.current?.reheat(0.3);
      startLoop();
      return;
    }

    if (drag?.mode === "pan") {
      drag.moved = Math.max(
        drag.moved,
        Math.hypot(point.screenX - drag.startX, point.screenY - drag.startY),
      );
      cameraRef.current = {
        ...cameraRef.current,
        x: drag.cameraX + (point.screenX - drag.startX),
        y: drag.cameraY + (point.screenY - drag.startY),
      };
      schedulePaint();
      return;
    }

    const hit = hitTest(point.x, point.y);
    if (hit !== hoveredId) onHover(hit);
  };

  /**
   * Ends a drag and returns it. Shared by the pointer-up and the cancel path,
   * because both have to release the capture and clear the drag.
   */
  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): DragState | null => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return drag;
  };

  const releaseNode = (id: string) => {
    const anchor = view.nodes.find((node) => node.kind === "user");
    if (anchor?.id === id) {
      // The anchor is pinned at the centre for the life of the picture, so a
      // drag of it is released back to that centre rather than to the
      // simulation — otherwise dragging the centre would unpin it for good.
      simulationRef.current?.pin(id, size.width / 2, size.height / 2);
    } else {
      // Releasing the pin is what lets the node settle back into the layout.
      simulationRef.current?.pin(id, 0, null);
    }
    simulationRef.current?.reheat(0.3);
    startLoop();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = endDrag(event);
    if (!drag) return;

    if (drag.mode === "node") {
      releaseNode(drag.id);
      if (drag.moved < CLICK_SLOP) onSelect(drag.id);
      return;
    }
    if (drag.moved < CLICK_SLOP) onSelect(null);
  };

  /**
   * A cancelled pointer never sends `pointerup`. Without this the drag stays
   * live — every later move keeps panning — and a node dragged when the gesture
   * was taken over stays pinned where it was put for the life of the
   * simulation. Nothing is selected: a cancelled gesture is not a click.
   */
  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = endDrag(event);
    if (drag?.mode === "node") releaseNode(drag.id);
  };

  const handlePointerLeave = () => {
    if (!dragRef.current) onHover(null);
  };

  return (
    <div ref={wrapperRef} className={cn("relative h-full w-full", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        className="h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      />
    </div>
  );
}
