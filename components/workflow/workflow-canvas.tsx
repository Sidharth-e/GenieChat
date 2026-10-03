"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Panel,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";

import { Plus, Minus, Maximize } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/components/providers/theme-provider";
import { NodeKind, type UIEdge, type UINode, type WorkflowNodeData } from "@/lib/workflow/types";
import type { RichWorkflow, RichWorkflowNode, RichWorkflowEdge } from "@/lib/types";
import { createNodeData } from "@/lib/workflow/create-node";
import { useWorkflowEditorStore } from "@/lib/stores/workflow-editor";
import { DefaultNode } from "@/components/workflow/default-node";
import { DefaultEdge } from "@/components/workflow/default-edge";
import { NodeSelect } from "@/components/workflow/node-select";
import { WorkflowCanvasPanel } from "@/components/workflow/workflow-canvas-panel";
import { Button } from "@/components/ui/button";

// ---- Constants ----

const nodeTypes = { workflow: DefaultNode };
const edgeTypes = { workflow: DefaultEdge };

// ---- Inner Canvas ----

interface WorkflowCanvasInnerProps {
  workflow: RichWorkflow;
  hasEditAccess: boolean;
  autoRun?: boolean;
}

function WorkflowCanvasInner({
  workflow,
  hasEditAccess,
  autoRun,
}: WorkflowCanvasInnerProps) {
  const { init, processIds } = useWorkflowEditorStore();
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } =
    useReactFlow<UINode>();
  const { resolvedTheme } = useTheme();

  const isProcessing = processIds.length > 0;

  // ---- Initial state from workflow data ----
  const [nodes, setNodesState] = useState<UINode[]>(() =>
    workflow.nodes.map((n) => ({
      id: n.id,
      type: "workflow" as const,
      position: n.position,
      data: { ...n.data, runtime: undefined },
    })),
  );

  const [edges, setEdges] = useState<UIEdge[]>(() =>
    workflow.edges.map((e) => ({
      id: e.id,
      type: "workflow" as const,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  );

  // ---- Track selected node ----
  const selectedNode = useMemo(
    () => nodes.find((n) => n.selected),
    [nodes],
  );

  // ---- Track active node IDs for edge highlighting ----
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNode) ids.add(selectedNode.id);
    if (hoveredNodeId) ids.add(hoveredNodeId);
    return ids;
  }, [selectedNode, hoveredNodeId]);

  // ---- Editability ----
  const editable = !isProcessing && hasEditAccess && !workflow.isPublished;

  // ---- Init store ----
  useEffect(() => {
    init(workflow, hasEditAccess);
  }, [workflow, hasEditAccess, init]);

  // ---- Node changes ----
  const onNodesChange = useCallback(
    (changes: NodeChange<UINode>[]) => {
      if (!editable) {
        // Only allow select and runtime replace changes
        const filtered = changes.filter(
          (c) =>
            c.type === "select" ||
            (c.type === "replace" && c.item?.data?.runtime !== undefined),
        );
        if (filtered.length > 0) {
          setNodesState((nds) => applyNodeChanges(filtered, nds));
        }
        return;
      }
      setNodesState((nds) => applyNodeChanges(changes, nds));
    },
    [editable],
  );

  // ---- Edge changes ----
  const onEdgesChange = useCallback(
    (changes: EdgeChange<UIEdge>[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [],
  );

  // ---- Connect ----
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!editable) return;
      const newEdge: UIEdge = {
        id: crypto.randomUUID(),
        type: "workflow",
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [editable],
  );

  // ---- Validation ----
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!editable) return false;
      // Self-loops stay forbidden: a node that depends on its own output is a
      // mistake, not a loop. Longer cycles are allowed — LangGraph supports
      // them, and `WORKFLOW_RECURSION_LIMIT` stops the ones that never exit.
      if (connection.source === connection.target) return false;

      // A condition branch routes to exactly one node; the branch's target is
      // what the graph builder reads back. Every other source handle may fan
      // out to as many nodes as the user wants.
      const sourceHandle = connection.sourceHandle;
      if (sourceHandle && sourceHandle !== "right") {
        return !edges.some(
          (e) => e.source === connection.source && e.sourceHandle === sourceHandle,
        );
      }
      return true;
    },
    [editable, edges],
  );

  // ---- Add node ----
  const handleAddNode = useCallback((kind: NodeKind) => {
    const data = createNodeData(kind);
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const position = {
      x: center.x + (Math.random() - 0.5) * 100,
      y: center.y + (Math.random() - 0.5) * 80,
    };
    const newNode: UINode = {
      id: data.id,
      type: "workflow",
      position,
      data: { ...data, runtime: undefined },
    };
    setNodesState((nds) => [...nds, newNode]);
  }, [screenToFlowPosition]);

  // ---- Hover tracking ----
  const onNodeMouseEnter = useCallback(
    (_event: React.MouseEvent, node: UINode) => {
      setHoveredNodeId(node.id);
    },
    [],
  );

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // ---- Edge styling based on runtime status ----
  const styledEdges = useMemo(() => {
    const errorIds = new Set<string>();
    const runningIds = new Set<string>();
    const successIds = new Set<string>();

    for (const node of nodes) {
      const status = node.data?.runtime?.status;
      if (status === "fail") errorIds.add(node.id);
      else if (status === "running") runningIds.add(node.id);
      else if (status === "success") successIds.add(node.id);
    }

    return edges.map((edge) => {
      let stroke: string | undefined;
      let animated = false;

      if (errorIds.has(edge.source)) {
        stroke = "#ef4444";
      } else if (successIds.has(edge.source) || runningIds.has(edge.source)) {
        stroke = "#05df72";
      }

      if (runningIds.has(edge.source)) {
        animated = true;
      }

      // Active hover/selection highlight
      if (
        activeNodeIds.has(edge.source) ||
        activeNodeIds.has(edge.target)
      ) {
        stroke = stroke || "var(--primary)";
      }

      return {
        ...edge,
        animated,
        data: { ...edge.data, editable },
        style: stroke ? { stroke, strokeWidth: 2 } : undefined,
      };
    });
  }, [edges, nodes, activeNodeIds, editable]);

  // ---- Save workflow structure to the server ----
  const save = useCallback(async () => {
    if (!workflow.id) return;

    const currentNodes: RichWorkflowNode[] = nodes.map((n) => {
      const data = { ...n.data };
      delete (data as { runtime?: unknown }).runtime;
      return {
        id: n.id,
        kind: data.kind,
        name: data.name,
        description: data.description,
        data: data as WorkflowNodeData,
        position: { x: n.position.x, y: n.position.y },
      };
    });

    const currentEdges: RichWorkflowEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    }));

    const currentNodeIds = new Set(currentNodes.map((n) => n.id));
    const currentEdgeIds = new Set(currentEdges.map((e) => e.id));
    const deleteNodes = workflow.nodes
      .filter((n) => !currentNodeIds.has(n.id))
      .map((n) => n.id);
    const deleteEdges = workflow.edges
      .filter((e) => !currentEdgeIds.has(e.id))
      .map((e) => e.id);

    const res = await fetch(`/api/workflows/${workflow.id}/structure`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodes: currentNodes,
        edges: currentEdges,
        deleteNodes,
        deleteEdges,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Save failed (${res.status})`);
    }

    const updated: RichWorkflow = await res.json();
    init(updated, hasEditAccess);
    toast.success("Workflow saved");
  }, [workflow, nodes, edges, init, hasEditAccess]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        fitView
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        deleteKeyCode={null}
        nodes={nodes}
        maxZoom={1.4}
        minZoom={0.1}
        edges={styledEdges}
        multiSelectionKeyCode={null}
        id={workflow.id}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={editable ? onEdgesChange : undefined}
        isValidConnection={isValidConnection}
        onConnect={editable ? onConnect : undefined}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        fitViewOptions={{ duration: 500, padding: 1 }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={12} size={0.6} />

        {/* Gradient overlays for visual polish */}
        <Panel position="top-left" className="!m-0 !p-0 w-full h-full pointer-events-none">
          {/* Top gradient */}
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background/80 to-transparent pointer-events-none" />
          {/* Bottom gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
          {/* Left gradient */}
          <div className="absolute top-0 left-0 bottom-0 w-16 bg-gradient-to-r from-background/80 to-transparent pointer-events-none" />
          {/* Right gradient */}
          <div className="absolute top-0 right-0 bottom-0 w-16 bg-gradient-to-l from-background/80 to-transparent pointer-events-none" />
        </Panel>

        {/* Top-right: Canvas panel with controls */}
        <Panel position="top-right" className="!mt-4 !mr-4">
          <WorkflowCanvasPanel
            workflow={workflow}
            selectedNode={selectedNode}
            isProcessing={isProcessing}
            hasEditAccess={hasEditAccess}
            onSave={save}
            autoRun={autoRun}
          />
        </Panel>

        {/* Bottom-left: Zoom controls */}
        <Panel position="bottom-left" className="!mb-6 !ml-6">
          <div className="flex items-center bg-background/90 backdrop-blur-xl border border-tertiary/20 p-1.5 rounded-2xl shadow-xl">
            <button
              onClick={() => zoomOut()}
              className="p-2 text-tertiary/70 hover:text-foreground hover:bg-tertiary/10 rounded-xl transition-colors"
              title="Zoom Out"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => zoomIn()}
              className="p-2 text-tertiary/70 hover:text-foreground hover:bg-tertiary/10 rounded-xl transition-colors"
              title="Zoom In"
            >
              <Plus className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-tertiary/20 mx-1.5" />
            <button
              onClick={() => fitView({ duration: 800, padding: 1 })}
              className="p-2 text-tertiary/70 hover:text-foreground hover:bg-tertiary/10 rounded-xl transition-colors"
              title="Fit View"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </Panel>

        {/* Top-left: Add node button */}
        {editable && (
          <Panel position="top-left" className="!mt-4 !ml-4">
            <div onPointerDown={(e) => e.stopPropagation()}>
              <NodeSelect onChange={handleAddNode}>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background/90 backdrop-blur-xl shadow-lg"
                >
                  <Plus className="size-4" />
                  Add Node
                </Button>
              </NodeSelect>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

// ---- Exported component with ReactFlowProvider ----

interface WorkflowCanvasProps {
  workflow: RichWorkflow;
  hasEditAccess?: boolean;
  autoRun?: boolean;
}

export default function WorkflowCanvas({
  workflow,
  hasEditAccess = false,
  autoRun,
}: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner
        workflow={workflow}
        hasEditAccess={hasEditAccess}
        autoRun={autoRun}
        key={`${workflow.id}:${workflow.updatedAt}`}
      />
    </ReactFlowProvider>
  );
}
