"use client";

/**
 * Draws the memory graph.
 *
 * React Flow is already a dependency for the workflow canvas, so this borrows
 * its pan, zoom and drag rather than reimplementing them. What it does *not*
 * borrow is a layout: React Flow draws nodes where you put them, and the
 * positions come from `layoutMemoryGraph` — see that module for why the
 * simulation is hand-rolled.
 *
 * Two encodings are deliberately redundant, because a graph in a single-accent
 * design system has to survive being read without colour:
 *
 * - **Node kind** is shape and size — a bordered card is a memory, a pill is an
 *   entity — never a hue.
 * - **Edge kind** is line style: solid, long-dash, dotted, each paired with a
 *   named legend entry, and the one semantically loaded kind (contradicts) also
 *   carries `--red`. The legend is what makes that safe, not the colour itself.
 *
 * The detail card on hover is also the accessibility fallback: the node's own
 * text is clamped, so the full memory is readable there, and the edge's
 * model-written `reason` is only readable there.
 */
import * as React from "react";
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";

import {
  MEMORY_GRAPH_EDGE_KINDS,
  MEMORY_GRAPH_ENTITY_NODE_SIZE,
  MEMORY_GRAPH_MEMORY_NODE_SIZE,
  type MemoryGraphEdgeKind,
} from "@/constants/memory";
import { useMemoryGraph } from "@/hooks/use-memories-queries";
import {
  filterMemoryGraphView,
  MEMORY_EDGE_LABELS,
  type MemoryGraphView,
  type MemoryGraphViewEdge,
  type MemoryGraphViewNode,
} from "@/lib/memory/graph-view";
import { layoutMemoryGraph } from "@/lib/memory/graph-layout";
import { useTheme } from "@/components/providers/theme-provider";
import { memoryGraphNodeTypes } from "@/components/memories/memory-graph-nodes";
import { cn } from "@/lib/utils";

/** The node radius the simulation is told about, derived from what is drawn. */
const MEMORY_RADIUS =
  Math.hypot(
    MEMORY_GRAPH_MEMORY_NODE_SIZE.width,
    MEMORY_GRAPH_MEMORY_NODE_SIZE.height,
  ) / 2;
const ENTITY_RADIUS =
  Math.hypot(
    MEMORY_GRAPH_ENTITY_NODE_SIZE.width,
    MEMORY_GRAPH_ENTITY_NODE_SIZE.height,
  ) / 2;

interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  /** Whether the arrowhead is drawn — see `toFlowEdges`. */
  directed: boolean;
}

/**
 * One style per edge kind. The dash patterns are what carry identity; the
 * strokes are only ever shades of the neutral ramp, with `--red` reserved for
 * the single kind whose meaning is a warning.
 */
const EDGE_STYLES: Record<MemoryGraphEdgeKind, EdgeStyle> = {
  ABOUT: { stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "2 3", directed: false },
  RELATES_TO: { stroke: "var(--text-soft)", strokeWidth: 1.5, directed: true },
  SUPERSEDES: { stroke: "var(--text-muted)", strokeWidth: 1.5, strokeDasharray: "6 3", directed: true },
  CONTRADICTS: { stroke: "var(--red)", strokeWidth: 1.5, directed: true },
  RELATION: { stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "1 3", directed: true },
};

/**
 * The legend is generated from the same list the assembler validates edge types
 * against, and labelled from the same map it labels the edges with — so adding a
 * kind is one edit in `constants/memory.ts`, and the legend cannot name an edge
 * differently from the tooltip. `MEMORY_GRAPH_EDGE_KINDS` is already ordered
 * structure-first, which is the order the legend should read in.
 */
function Legend() {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-card-border bg-card-bg/95 px-3 py-2 shadow-sm backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-text-secondary">
        Nodes
      </p>
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-5 rounded-[3px] border border-card-border bg-surface-muted" />
        <span className="text-[11px] text-text-secondary">memory</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-2 w-5 rounded-full border border-card-border bg-surface-muted" />
        <span className="text-[11px] text-text-secondary">entity</span>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-secondary">
        Edges
      </p>
      {MEMORY_GRAPH_EDGE_KINDS.map((kind) => (
        <div key={kind} className="flex items-center gap-2">
          <LegendLine style={EDGE_STYLES[kind]} />
          <span className="text-[11px] text-text-secondary">
            {MEMORY_EDGE_LABELS[kind]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Maps the view onto React Flow nodes, at the positions already computed.
 *
 * Positions arrive as an argument rather than being computed here, because the
 * layout is O(n²) and this function also runs when the selection changes — a
 * node's neighbours stay lit and the rest dim. Re-laying out on every click
 * would be a second of work to draw the same picture.
 */
function toFlowNodes(
  view: MemoryGraphView,
  positions: Record<string, { x: number; y: number }>,
  focusId: string | null,
): Node[] {
  // The focused node and its direct neighbours stay legible; everything else
  // recedes. On a dense graph this is what turns a select into an answer about
  // one memory, rather than a highlight the eye has to hunt for.
  const lit = new Set<string>();
  if (focusId) {
    lit.add(focusId);
    for (const edge of view.edges) {
      if (edge.source === focusId) lit.add(edge.target);
      else if (edge.target === focusId) lit.add(edge.source);
    }
  }

  return view.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      detail: node.detail,
      degree: node.degree,
      dimmed: focusId !== null && !lit.has(node.id),
    },
  }));
}

function toFlowEdges(view: MemoryGraphView): Edge[] {
  return view.edges.map((edge) => {
    const style = EDGE_STYLES[edge.kind];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      // The default (bezier) edge is the smooth curve the picture wants; a
      // straight line between centre-anchored handles reads as a diagram.
      type: "default",
      style: {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDasharray: style.strokeDasharray,
      },
      // Only where the direction is a claim rather than structure: an arrow from
      // a memory to the entity it mentions would assert an order that is not
      // there, while SUPERSEDES pointing the wrong way is simply wrong.
      markerEnd: style.directed
        ? { type: MarkerType.ArrowClosed, color: style.stroke, width: 12, height: 12 }
        : undefined,
    };
  });
}

/** A legend key: the line style itself, drawn small. */
function LegendLine({ style }: { style: EdgeStyle }) {
  return (
    <svg width="26" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="26"
        y2="4"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth + 0.5}
        strokeDasharray={style.strokeDasharray}
      />
    </svg>
  );
}

interface DetailCardProps {
  node: MemoryGraphViewNode | null;
  edge: MemoryGraphViewEdge | null;
}

/** The hover layer: full text for a clamped node, and the reason for an edge. */
function DetailCard({ node, edge }: DetailCardProps) {
  if (!node && !edge) return null;

  return (
    <div className="max-w-xs rounded-md border border-card-border bg-card-bg/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
      {node && (
        <>
          <p className="text-[10px] uppercase tracking-wide text-text-secondary">
            {node.kind === "memory" ? "Memory" : "Entity"}
          </p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">
            {node.detail}
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-text-secondary">
            {node.degree} link{node.degree === 1 ? "" : "s"}
            {node.createdAt &&
              ` · ${new Date(node.createdAt).toLocaleDateString()}`}
          </p>
        </>
      )}
      {edge && (
        <>
          <p className="text-[10px] uppercase tracking-wide text-text-secondary">
            Edge
          </p>
          <p className="mt-1 text-foreground">{edge.label}</p>
          {typeof edge.weight === "number" && (
            <p className="mt-0.5 font-mono text-[10px] text-text-secondary">
              weight {edge.weight.toFixed(2)}
            </p>
          )}
          {edge.reason && (
            <p className="mt-1 leading-relaxed text-text-secondary">
              {edge.reason}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface MemoryGraphProps {
  searchQuery: string;
  className?: string;
}

function MemoryGraphCanvas({ searchQuery, className }: MemoryGraphProps) {
  const { data, isLoading, error } = useMemoryGraph();
  const { resolvedTheme } = useTheme();

  // The filter re-runs the layout, which is O(n²). Deferring the query lets the
  // input stay responsive while the graph catches up a frame later, rather than
  // blocking every keystroke on a layout pass.
  const deferredQuery = React.useDeferredValue(searchQuery);

  const [hoveredNode, setHoveredNode] = React.useState<MemoryGraphViewNode | null>(null);
  const [hoveredEdge, setHoveredEdge] = React.useState<MemoryGraphViewEdge | null>(null);
  // The id, not the node object: a search can filter the selected node out of
  // the view, and storing the node would leave a stale one focused.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const view = React.useMemo(
    () => (data ? filterMemoryGraphView(data, deferredQuery) : null),
    [data, deferredQuery],
  );

  const selected = view?.nodes.find((node) => node.id === selectedId) ?? null;

  // The expensive step, and the one that must not depend on the selection: the
  // simulation is deterministic, so a re-run on select would produce the same
  // positions at full cost.
  const positions = React.useMemo(
    () =>
      view
        ? layoutMemoryGraph(
            view.nodes.map((node) => ({
              id: node.id,
              radius: node.kind === "memory" ? MEMORY_RADIUS : ENTITY_RADIUS,
            })),
            view.edges,
          )
        : {},
    [view],
  );

  const focusId = selected?.id ?? null;
  const nodes = React.useMemo(
    () => (view ? toFlowNodes(view, positions, focusId) : []),
    [view, positions, focusId],
  );
  const edges = React.useMemo(() => (view ? toFlowEdges(view) : []), [view]);

  const clearHover = React.useCallback(() => {
    setHoveredNode(null);
    setHoveredEdge(null);
  }, []);

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

  if (!view || view.nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex h-[70vh] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-card-border bg-card-bg",
          className,
        )}
      >
        <p className="text-sm text-foreground">
          {deferredQuery ? "No memories match that search" : "Nothing to draw yet"}
        </p>
        <p className="text-xs text-text-secondary">
          {deferredQuery
            ? "The graph only draws what is already in your memory list."
            : "Memories and the entities they mention appear here as a graph."}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-md border border-card-border bg-card-bg">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={memoryGraphNodeTypes}
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeMouseEnter={(_event, node) => {
            setHoveredNode(view.nodes.find((entry) => entry.id === node.id) ?? null);
            setHoveredEdge(null);
          }}
          onNodeMouseLeave={clearHover}
          onNodeClick={(_event, node) => {
            // Clicking the focused node again clears it, so the card is not a
            // thing the reader has to hunt for a close button to dismiss, and
            // the dimming lifts with it.
            setSelectedId((current) => (current === node.id ? null : node.id));
          }}
          onEdgeMouseEnter={(_event, edge) => {
            setHoveredEdge(view.edges.find((entry) => entry.id === edge.id) ?? null);
            setHoveredNode(null);
          }}
          onEdgeMouseLeave={clearHover}
          onPaneClick={() => {
            setSelectedId(null);
            clearHover();
          }}
        >
          <Background gap={16} size={0.6} />
          <Controls showInteractive={false} />
          <Panel position="bottom-left" className="!m-3">
            <Legend />
          </Panel>
          <Panel position="top-right" className="!m-3">
            <DetailCard node={hoveredNode ?? selected} edge={hoveredEdge} />
          </Panel>
        </ReactFlow>
      </div>

      {view.truncated && (
        <p className="mt-2 text-xs text-text-secondary">
          Showing {view.nodes.length} nodes from your most recent memories
          {view.totalMemories > 0 && ` — ${view.totalMemories} in total`}. The
          older ones are on the list view.
        </p>
      )}
    </div>
  );
}

/**
 * React Flow reads its own context, so the provider has to sit above the canvas.
 */
export function MemoryGraph(props: MemoryGraphProps) {
  return (
    <ReactFlowProvider>
      <MemoryGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
