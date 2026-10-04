"use client";

/**
 * The Graph tab: the frame around the drawing.
 *
 * The picture is a canvas (see `memory-graph-canvas.tsx`), so everything a
 * canvas cannot carry lives here — the legend, the hover and selection card, the
 * loading, error and empty states, the truncation notice, and the keyboard path
 * through the nodes.
 *
 * Identity is carried two ways over, because a graph in a single-accent design
 * system has to survive being read without colour:
 *
 * - **Node kind** is shape *and* size — a rounded square is a memory, a circle
 *   an entity, a diamond a predicate, a smaller circle a value — with the
 *   categorical palette only reinforcing it.
 * - **Edge kind** is line style — solid, long-dash, dotted — each with a named
 *   legend entry.
 *
 * A canvas has no DOM to read, so the accessibility fallback is built in rather
 * than bolted on: the canvas carries a `role="img"` summary, it is focusable and
 * arrow-navigable in degree order, the focused node is announced through a live
 * region, and the List tab remains the full non-visual surface.
 */
import * as React from "react";

import { MEMORY_GRAPH_KEYBOARD_LIMIT } from "@/constants/memory";
import { useMemoryGraph } from "@/hooks/use-memories-queries";
import { useMemoryGraphPalette } from "@/hooks/use-memory-graph-palette";
import {
  keyboardTraversalOrder,
  matchMemoryGraphNodes,
  MEMORY_GRAPH_EDGE_LABELS,
  MEMORY_GRAPH_EDGE_STYLE,
  MEMORY_GRAPH_NODE_LABELS,
  MEMORY_GRAPH_NODE_TOKEN,
  type MemoryGraphEdgeKind,
  type MemoryGraphNodeKind,
  type MemoryGraphViewNode,
} from "@/lib/memory/graph-view";
import { MemoryGraphCanvas } from "@/components/memories/memory-graph-canvas";
import { cn } from "@/lib/utils";

const NODE_KINDS: MemoryGraphNodeKind[] = ["fact", "entity", "predicate", "value"];
const EDGE_KINDS: MemoryGraphEdgeKind[] = ["SUBJECT", "PREDICATE", "OBJECT"];

/**
 * The legend is generated from the same maps the canvas draws from, so a kind
 * cannot be named differently in the two places. The shapes are the canvas's
 * shapes at legend scale — shape and size are what carry the kind on their own.
 */
function Legend() {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-card-border bg-card-bg/95 px-3 py-2 shadow-sm backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-text-secondary">Nodes</p>
      {NODE_KINDS.map((kind) => (
        <div key={kind} className="flex items-center gap-2">
          <LegendNode kind={kind} />
          <span className="text-[11px] text-text-secondary">
            {MEMORY_GRAPH_NODE_LABELS[kind].toLowerCase()}
          </span>
        </div>
      ))}
      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-secondary">Edges</p>
      {EDGE_KINDS.map((kind) => (
        <div key={kind} className="flex items-center gap-2">
          <LegendLine kind={kind} />
          <span className="text-[11px] text-text-secondary">
            {MEMORY_GRAPH_EDGE_LABELS[kind]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A legend key for a node kind: its shape, at legend scale, in its own colour. */
function LegendNode({ kind }: { kind: MemoryGraphNodeKind }) {
  const fill = `var(${MEMORY_GRAPH_NODE_TOKEN[kind]})`;
  return (
    <svg width="14" height="14" aria-hidden="true" className="shrink-0">
      {kind === "fact" && <rect x="2.5" y="2.5" width="9" height="9" rx="2.5" fill={fill} />}
      {kind === "entity" && <circle cx="7" cy="7" r="4.5" fill={fill} />}
      {kind === "predicate" && <polygon points="7,2.5 11.5,7 7,11.5 2.5,7" fill={fill} />}
      {kind === "value" && <circle cx="7" cy="7" r="3" fill={fill} />}
    </svg>
  );
}

/** A legend key for an edge kind: the line style itself, drawn small. */
function LegendLine({ kind }: { kind: MemoryGraphEdgeKind }) {
  const style = MEMORY_GRAPH_EDGE_STYLE[kind];
  return (
    <svg width="26" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="26"
        y2="4"
        stroke={`var(${style.token})`}
        strokeWidth={style.width + 0.5}
        strokeDasharray={style.dash ? style.dash.join(" ") : undefined}
      />
    </svg>
  );
}

/**
 * The hover and selection layer. The node's own text is clamped on the canvas,
 * so this is the only place the whole sentence is readable.
 */
function DetailCard({ node }: { node: MemoryGraphViewNode }) {
  return (
    <div className="max-w-xs rounded-md border border-card-border bg-card-bg/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-text-secondary">
        {MEMORY_GRAPH_NODE_LABELS[node.kind]}
      </p>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{node.detail}</p>
      <p className="mt-1.5 font-mono text-[10px] text-text-secondary">
        {node.degree} link{node.degree === 1 ? "" : "s"}
        {node.createdAt && ` · ${new Date(node.createdAt).toLocaleDateString()}`}
      </p>
    </div>
  );
}

interface MemoryGraphProps {
  searchQuery: string;
  className?: string;
}

export function MemoryGraph({ searchQuery, className }: MemoryGraphProps) {
  const { data, isLoading, error } = useMemoryGraph();
  const palette = useMemoryGraphPalette();

  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Where the keyboard is. Distinct from the selection: arrowing through the
  // graph must not open a card on every node it passes over.
  const [focusedId, setFocusedId] = React.useState<string | null>(null);

  const traversal = React.useMemo(
    () => (data ? keyboardTraversalOrder(data).slice(0, MEMORY_GRAPH_KEYBOARD_LIMIT) : []),
    [data],
  );

  // The card follows the pointer, and falls back to the click when the pointer
  // has left — the way a selection stays readable after the mouse moves on.
  const detailedId = hoveredId ?? selectedId;
  const detailedNode = data?.nodes.find((node) => node.id === detailedId) ?? null;
  const focusedNode = data?.nodes.find((node) => node.id === focusedId) ?? null;

  const matches = React.useMemo(
    () => (data ? matchMemoryGraphNodes(data, searchQuery) : null),
    [data, searchQuery],
  );
  const noMatches = matches !== null && matches.size === 0;

  const handleSelect = React.useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setFocusedId(id);
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (traversal.length === 0) return;
      const index = focusedId ? traversal.indexOf(focusedId) : -1;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          setFocusedId(traversal[(index + 1) % traversal.length]);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          setFocusedId(index <= 0 ? traversal[traversal.length - 1] : traversal[index - 1]);
          break;
        case "Enter":
          if (focusedId) {
            event.preventDefault();
            setSelectedId(focusedId);
          }
          break;
        case "Escape":
          setFocusedId(null);
          setSelectedId(null);
          break;
      }
    },
    [traversal, focusedId],
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex h-[70vh] items-center justify-center rounded-md border border-card-border bg-card-bg",
          className,
        )}
      >
        <p className="text-sm text-text-secondary">Loading the memory graph…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex h-[70vh] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-card-border bg-card-bg",
          className,
        )}
      >
        <p className="text-sm text-foreground">Could not build the memory graph</p>
        <p className="text-xs text-text-secondary">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex h-[70vh] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-card-border bg-card-bg",
          className,
        )}
      >
        <p className="text-sm text-foreground">Nothing to draw yet</p>
        <p className="text-xs text-text-secondary">
          Memories and the entities they mention appear here as a graph.
        </p>
      </div>
    );
  }

  const factCount = data.nodes.filter((node) => node.kind === "fact").length;
  const satelliteCount = data.nodes.length - factCount;
  const ariaLabel =
    `Memory graph: ${factCount} ${factCount === 1 ? "memory" : "memories"} linked through ` +
    `${satelliteCount} shared entities, predicates and values. ` +
    "Use the arrow keys to step through the most connected nodes, Enter to open one, Escape to clear.";

  return (
    <div className={cn("relative", className)}>
      <div className="relative h-[70vh] min-h-[420px] overflow-hidden rounded-md border border-card-border bg-card-bg">
        <MemoryGraphCanvas
          view={data}
          query={searchQuery}
          palette={palette}
          hoveredId={hoveredId}
          selectedId={selectedId}
          focusedId={focusedId}
          ariaLabel={ariaLabel}
          onHover={setHoveredId}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
        />
        <div className="pointer-events-none absolute bottom-3 left-3">
          <Legend />
        </div>
        {detailedNode && (
          <div className="pointer-events-none absolute right-3 top-3">
            <DetailCard node={detailedNode} />
          </div>
        )}
      </div>

      {/* The canvas has no DOM, so the focused node is announced rather than
          rendered — without this the keyboard traversal is silent. */}
      <p aria-live="polite" className="sr-only">
        {focusedNode
          ? `${MEMORY_GRAPH_NODE_LABELS[focusedNode.kind]}: ${focusedNode.label}`
          : ""}
      </p>

      {noMatches && (
        <p className="mt-2 text-xs text-text-secondary">No memories match that search.</p>
      )}

      {data.truncated && (
        <p className="mt-2 text-xs text-text-secondary">
          Drawing your {factCount} most recent {factCount === 1 ? "memory" : "memories"} —{" "}
          {data.totalFacts} in total. The older ones are on the list view.
        </p>
      )}
    </div>
  );
}
