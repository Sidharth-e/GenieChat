"use client";

/**
 * The two node types the memory graph draws.
 *
 * Identity is carried by *shape and size*, not by colour: a memory is a bordered
 * card, an entity is a small pill. That is deliberate — this design system has a
 * single neutral accent, and a graph where the only difference between two kinds
 * of node is a hue would be unreadable for a colourblind reader and for anyone
 * printing it. The legend names both; the tooltip names the one under the
 * cursor.
 *
 * Both nodes place their handles in the centre and hide them. A force layout has
 * no notion of a "top" or a "bottom" for an edge to leave from, so anchored
 * handles would route every edge into the same corner of every node and the
 * picture would read as a diagram rather than a graph.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MEMORY_GRAPH_ENTITY_NODE_SIZE,
  MEMORY_GRAPH_MEMORY_NODE_SIZE,
} from "@/constants/memory";
import { cn } from "@/lib/utils";

export interface MemoryGraphNodeData extends Record<string, unknown> {
  label: string;
  detail: string;
  degree: number;
  /**
   * True when another node is selected and this one is neither it nor a direct
   * neighbour. Set by `toFlowNodes`, which is the only place the lit set is
   * known.
   */
  dimmed?: boolean;
}

/**
 * A centre-anchored, invisible connection point. `Position.Top` is only the
 * declared side — the inline offset is what actually centres it.
 */
const CENTRED_HANDLE =
  "!pointer-events-none !min-h-0 !min-w-0 !border-0 !bg-transparent opacity-0";

const handleStyle = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
} as const;

function CentreHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={handleStyle}
        className={CENTRED_HANDLE}
      />
      <Handle
        type="source"
        position={Position.Top}
        isConnectable={false}
        style={handleStyle}
        className={CENTRED_HANDLE}
      />
    </>
  );
}

/** A memory: the thing the reader came for, so it gets the space. */
export function MemoryNode({ data, selected }: NodeProps) {
  const { label, degree, dimmed } = data as MemoryGraphNodeData;
  return (
    <div
      style={{ width: MEMORY_GRAPH_MEMORY_NODE_SIZE.width }}
      className={cn(
        "rounded-md border bg-card-bg px-3 py-2 shadow-xs transition-opacity",
        selected ? "border-foreground" : "border-card-border",
        dimmed && "opacity-30",
      )}
    >
      <CentreHandles />
      {/* Two lines, not three: the card has to stay near
          `MEMORY_GRAPH_MEMORY_NODE_SIZE.height`, which is what the layout is
          told the node's radius is. A card taller than the layout believes
          overlaps its neighbours. The full text is in the hover card. */}
      <p className="line-clamp-2 text-xs leading-snug text-foreground">{label}</p>
      {degree > 0 && (
        <p className="mt-1 font-mono text-[10px] text-text-secondary">
          {degree} link{degree === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

/** An entity: connective tissue, so it is small and quiet. */
export function EntityNode({ data, selected }: NodeProps) {
  const { label, dimmed } = data as MemoryGraphNodeData;
  return (
    <div
      style={{ width: MEMORY_GRAPH_ENTITY_NODE_SIZE.width }}
      className={cn(
        "truncate rounded-full border bg-surface-muted px-2.5 py-1 text-center text-[11px] transition-opacity",
        selected ? "border-foreground text-foreground" : "border-card-border text-text-secondary",
        dimmed && "opacity-30",
      )}
    >
      <CentreHandles />
      {label}
    </div>
  );
}

/** Passed to `nodeTypes`. Defined once, not inline: React Flow warns on a new object. */
export const memoryGraphNodeTypes = {
  memory: MemoryNode,
  entity: EntityNode,
};
