"use client";

import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import type { UIEdge } from "@/lib/workflow/types";

type Props = EdgeProps<UIEdge>;

export const DefaultEdge = memo(function DefaultEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  selected,
  data,
}: Props) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (event: React.MouseEvent) => {
    // Without this the click also reaches the pane and clears the selection.
    event.stopPropagation();
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
  };

  // Only offer deletion where it can land: a non-editable canvas passes no
  // `onEdgesChange`, so a click would be a no-op.
  const showDelete = data?.editable === true && (hovered || selected);

  return (
    <>
      {/* The group carries hover so it covers BaseEdge's invisible wide
          interaction path, not just the 2px stroke. */}
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      </g>

      {showDelete && (
        <EdgeLabelRenderer>
          <button
            type="button"
            onClick={handleDelete}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title="Delete connection"
            aria-label="Delete connection"
            className="wf-edge-delete nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // The label renderer is pointer-events: none so edges stay
              // click-through; the button opts back in.
              pointerEvents: "all",
            }}
          >
            <X className="size-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
DefaultEdge.displayName = "DefaultEdge";
