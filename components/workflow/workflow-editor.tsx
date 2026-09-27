"use client";

import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  ReactFlowProvider,
  BackgroundVariant,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Agent,
  Workflow,
  WorkflowOutputConfig,
  WorkflowOutputType,
  WorkflowStep,
  WorkflowTrigger,
  RichWorkflow,
} from "@/lib/types";
import WorkflowCanvas from "@/components/workflow/workflow-canvas";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Bot, Plus, Minus, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentNode, TriggerNode, OutputNode } from "./custom-nodes";
import { validateWorkflowSteps } from "@/lib/workflow/validation";
import { useTheme } from "@/components/providers/theme-provider";

const nodeTypes = {
  agent: AgentNode,
  trigger: TriggerNode,
  workflowOutput: OutputNode,
};

const FLOW_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 0.82,
};

function CustomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute bottom-6 left-6 z-10 flex items-center bg-background/90 backdrop-blur-xl border border-tertiary/20 p-1.5 rounded-2xl shadow-xl">
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
        onClick={() => fitView({ ...FLOW_FIT_VIEW_OPTIONS, duration: 800 })}
        className="p-2 text-tertiary/70 hover:text-foreground hover:bg-tertiary/10 rounded-xl transition-colors"
        title="Fit View"
      >
        <Maximize className="w-4 h-4" />
      </button>
    </div>
  );
}

interface WorkflowEditorProps {
  workflow: Workflow | null;
  agents: Agent[];
  onSave?: (data: {
    name: string;
    description: string;
    trigger?: WorkflowTrigger;
    output?: WorkflowOutputConfig;
    steps: Partial<WorkflowStep>[];
    outputPosition?: { x: number; y: number };
  }) => Promise<void>;
  isSubmitting?: boolean;
  readonly?: boolean;
  richWorkflow?: RichWorkflow;
  autoRun?: boolean;
}

function generateInitialFlow(
  workflow: Workflow | null,
  agents: Agent[],
  handleNodeChange: (id: string, dataUpdates: Record<string, unknown>) => void,
  handleNodeDelete: (id: string) => void,
  readonly?: boolean,
) {
  const nodes: Node[] = [];
  const agentEdges: Edge[] = [];
  const defaultTriggerPosition = { x: 50, y: 150 };
  const triggerPosition =
    workflow?.trigger?.config?.position &&
    typeof workflow.trigger.config.position.x === "number" &&
    typeof workflow.trigger.config.position.y === "number"
      ? {
          x: workflow.trigger.config.position.x,
          y: workflow.trigger.config.position.y,
        }
      : defaultTriggerPosition;

  // Trigger node — always present, not deletable
  nodes.push({
    id: "trigger",
    type: "trigger",
    position: triggerPosition,
    data: {
      id: "trigger",
      triggerType: workflow?.trigger?.type || "manual",
      webhookSecret: workflow?.trigger?.config?.webhookSecret || "",
      cronExpression: workflow?.trigger?.config?.cronExpression || "",
      onChange: handleNodeChange,
      readonly,
    },
  });

  if (workflow && workflow.steps && workflow.steps.length > 0) {
    // Determine all nextStep targets for identifying start nodes
    const allNextSteps = new Set<string>();
    workflow.steps.forEach((s) => {
      if (s.nextSteps) {
        s.nextSteps.forEach((ns) => allNextSteps.add(ns));
      }
    });

    // Add agent nodes and agent-to-agent edges
    workflow.steps.forEach((step, index) => {
      const stepId = step.id || `step_${index}`;
      const fallbackPosition = {
        x: 280 + index * 260,
        y: 140 + (index % 2) * 40,
      };
      const stepPosition =
        step.position &&
        typeof step.position.x === "number" &&
        typeof step.position.y === "number"
          ? { x: step.position.x, y: step.position.y }
          : fallbackPosition;

      nodes.push({
        id: stepId,
        type: "agent",
        position: stepPosition,
        data: {
          id: stepId,
          name: step.name || `Step ${index + 1}`,
          agentId: step.agentId,
          input: step.input,
          agents,
          onChange: handleNodeChange,
          onDelete: handleNodeDelete,
          readonly,
          status: step.status,
        },
      });

      // Agent-to-agent edges only (not trigger/output — those are auto-computed)
      if (step.nextSteps && step.nextSteps.length > 0) {
        step.nextSteps.forEach((nextId) => {
          agentEdges.push({
            id: `e-${stepId}-${nextId}`,
            source: stepId,
            target: nextId,
            type: "smoothstep",
          });
        });
      }
    });

    // Output node
    const defaultOutputPosition = {
      x: 280 + workflow.steps.length * 260,
      y: 140,
    };
    const outputPosition =
      workflow.outputPosition &&
      typeof workflow.outputPosition.x === "number" &&
      typeof workflow.outputPosition.y === "number"
        ? { x: workflow.outputPosition.x, y: workflow.outputPosition.y }
        : defaultOutputPosition;

    nodes.push({
      id: "output",
      type: "workflowOutput",
      position: outputPosition,
      data: {
        id: "output",
        outputType: workflow.output?.type || "markdown",
        onChange: handleNodeChange,
        readonly,
      },
    });
  } else {
    // Default: one agent step
    nodes.push({
      id: "step_0",
      type: "agent",
      position: { x: 320, y: 140 },
      data: {
        id: "step_0",
        name: "Step 1",
        agentId: "",
        input: "",
        agents,
        onChange: handleNodeChange,
        onDelete: handleNodeDelete,
        readonly,
      },
    });

    const defaultOutputPosition = { x: 580, y: 140 };
    const outputPosition =
      workflow?.outputPosition &&
      typeof workflow.outputPosition.x === "number" &&
      typeof workflow.outputPosition.y === "number"
        ? { x: workflow.outputPosition.x, y: workflow.outputPosition.y }
        : defaultOutputPosition;

    nodes.push({
      id: "output",
      type: "workflowOutput",
      position: outputPosition,
      data: {
        id: "output",
        outputType: workflow?.output?.type || "markdown",
        onChange: handleNodeChange,
        readonly,
      },
    });
  }

  // Only agent-to-agent edges are visible; trigger/output connections are implicit
  return { nodes, edges: agentEdges };
}

function WorkflowEditorBody({
  workflow,
  agents,
  onSave,
  isSubmitting,
  readonly,
}: WorkflowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description || "");
  const [isDirty, setIsDirty] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const styledEdges = useMemo(() => {
    const activeIds = new Set<string>();
    const runningIds = new Set<string>();
    const completedIds = new Set<string>();
    const errorIds = new Set<string>();

    nodes.forEach((n) => {
      if (n.selected) activeIds.add(n.id);
      const status = n.data?.status as string | undefined;
      if (status === "running") runningIds.add(n.id);
      else if (status === "completed") completedIds.add(n.id);
      else if (status === "error") errorIds.add(n.id);
    });
    if (hoveredNodeId) activeIds.add(hoveredNodeId);

    return edges.map((edge) => {
      let stroke: string | undefined;
      let animated = false;

      if (errorIds.has(edge.source)) {
        stroke = "#ef4444";
      } else if (runningIds.has(edge.source)) {
        stroke = "#05df72";
        animated = true;
      } else if (completedIds.has(edge.source)) {
        stroke = "#05df72";
      }

      if (!stroke && (activeIds.has(edge.source) || activeIds.has(edge.target))) {
        stroke = "var(--primary)";
      }

      return {
        ...edge,
        animated,
        style: stroke ? { stroke, strokeWidth: 2 } : undefined,
      };
    });
  }, [edges, nodes, hoveredNodeId]);

  // Function to update data within a node
  const handleNodeDataChange = useCallback((id: string, dataUpdates: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: { ...node.data, ...dataUpdates },
          };
        }
        return node;
      }),
    );
    setEditorError(null);
    setIsDirty(true);
  }, []);

  const handleNodeDelete = useCallback((id: string) => {
    if (id === "trigger" || id === "output") {
      setEditorError("Trigger and Output nodes cannot be deleted.");
      return;
    }
    setNodes((nds) => nds.filter((node) => node.id !== id));
    setEdges((eds) =>
      eds.filter((edge) => edge.source !== id && edge.target !== id),
    );
    setEditorError(null);
    setIsDirty(true);
  }, []);

  useEffect(() => {
    const { nodes: initialNodes, edges: initialEdges } = generateInitialFlow(
      workflow,
      agents,
      handleNodeDataChange,
      handleNodeDelete,
      readonly,
    );
    setNodes(initialNodes);
    setEdges(initialEdges);
    setEditorError(null);
  }, [workflow, agents, handleNodeDataChange, handleNodeDelete, readonly]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    setEditorError(null);
    setIsDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    setEditorError(null);
    setIsDirty(true);
  }, []);

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return;

    // Only allow agent-to-agent connections
    if (
      params.source === "trigger" ||
      params.source === "output" ||
      params.target === "trigger" ||
      params.target === "output"
    ) {
      setEditorError(
        "Trigger and Output connections are managed automatically. Connect agents to each other.",
      );
      return;
    }
    if (params.source === params.target) {
      setEditorError("A step cannot connect to itself.");
      return;
    }

    setEdges((eds) => {
      const alreadyConnected = eds.some(
        (edge) =>
          edge.source === params.source && edge.target === params.target,
      );
      if (alreadyConnected) return eds;
      return addEdge({ ...params, type: "smoothstep" }, eds);
    });
    setEditorError(null);
    setIsDirty(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleAddNode = useCallback(
    (position?: { x: number; y: number }) => {
      const newNodeId = `agent_${Date.now()}`;

      // If no position provided, use center of the wrapper
      let nodePosition = position;
      if (!nodePosition && reactFlowWrapper.current) {
        const rect = reactFlowWrapper.current.getBoundingClientRect();
        nodePosition = screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      } else if (!nodePosition) {
        nodePosition = { x: 400, y: 200 };
      }

      const newNode: Node = {
        id: newNodeId,
        type: "agent",
        position: nodePosition,
        data: {
          id: newNodeId,
          name: "New Step",
          agentId: "",
          input: "",
          agents,
          onChange: handleNodeDataChange,
          onDelete: handleNodeDelete,
          readonly,
        },
      };

      setNodes((nds) => nds.concat(newNode));
      setEditorError(null);
      setIsDirty(true);
    },
    [
      agents,
      handleNodeDataChange,
      handleNodeDelete,
      readonly,
      screenToFlowPosition,
    ],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (type !== "agent") return;

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      handleAddNode(position);
    },
    [handleAddNode, screenToFlowPosition],
  );

  const validateGraph = useCallback((): string | null => {
    const agentNodes = nodes.filter((node) => node.type === "agent");

    if (agentNodes.length === 0) {
      return "Add at least one Agent node.";
    }

    // Check for self-loops in agent edges
    const agentIds = new Set(agentNodes.map((n) => n.id));
    const agentEdges = edges.filter(
      (e) => agentIds.has(e.source) && agentIds.has(e.target),
    );
    for (const edge of agentEdges) {
      if (edge.source === edge.target) {
        return "A step cannot connect to itself.";
      }
    }

    return null;
  }, [edges, nodes]);

  const handleSave = async () => {
    if (!name.trim()) {
      setEditorError("Workflow name is required.");
      return;
    }

    const graphError = validateGraph();
    if (graphError) {
      setEditorError(graphError);
      return;
    }

    const steps: Partial<WorkflowStep>[] = [];
    let order = 0;

    // Only agent nodes become steps
    const agentNodes = nodes.filter((n) => n.type === "agent");
    const agentIds = new Set(agentNodes.map((n) => n.id));

    agentNodes.forEach((node) => {
      // Find outgoing edges to other agent nodes only
      const outgoingEdges = edges.filter(
        (e) => e.source === node.id && agentIds.has(e.target),
      );
      const nextSteps = outgoingEdges.map((e) => e.target);

      steps.push({
        id: node.id,
        name: `${node.data.name || ""}`.trim() || `Step ${order + 1}`,
        agentId: `${node.data.agentId || ""}`,
        input: `${node.data.input || ""}`,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
        order,
        nextSteps,
      });
      order++;
    });

    const stepValidation = validateWorkflowSteps(steps);
    if (!stepValidation.valid) {
      setEditorError(stepValidation.errors[0]);
      return;
    }

    // Extract trigger data
    const triggerNode = nodes.find((n) => n.type === "trigger");
    const triggerData = triggerNode?.data;
    const outputNode = nodes.find((n) => n.type === "workflowOutput");
    const triggerPosition = triggerNode
      ? { x: triggerNode.position.x, y: triggerNode.position.y }
      : undefined;
    const outputPosition = outputNode
      ? { x: outputNode.position.x, y: outputNode.position.y }
      : undefined;
    const outputType =
      (outputNode?.data?.outputType as WorkflowOutputType | undefined) ||
      "markdown";
    const output: WorkflowOutputConfig = { type: outputType };
    const trigger = {
      type:
        (triggerData?.triggerType as "manual" | "webhook" | "schedule") ||
        "manual",
      config: {
        webhookSecret: (triggerData?.webhookSecret as string) || undefined,
        cronExpression: (triggerData?.cronExpression as string) || undefined,
        position: triggerPosition,
      },
    };

    try {
      if (onSave) {
        await onSave({
          name: name.trim(),
          description,
          trigger,
          output,
          steps,
          outputPosition,
        });
      }
      setEditorError(null);
      setIsDirty(false);
    } catch {
      setEditorError("Failed to save workflow. Please try again.");
    }
  };

  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("application/reactflow", "agent");
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex-1 h-full w-full relative flex">
      {/* Canvas */}
      <div className="flex-1 w-full h-full relative" ref={reactFlowWrapper}>
        <ReactFlow
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          nodes={nodes}
          edges={styledEdges}
          onNodesChange={readonly ? undefined : onNodesChange}
          onEdgesChange={readonly ? undefined : onEdgesChange}
          onConnect={readonly ? undefined : onConnect}
          onDrop={readonly ? undefined : onDrop}
          onDragOver={readonly ? undefined : onDragOver}
          onNodeMouseEnter={readonly ? undefined : onNodeMouseEnter}
          onNodeMouseLeave={readonly ? undefined : onNodeMouseLeave}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
          nodesDraggable={!readonly}
          nodesConnectable={!readonly}
          elementsSelectable={true}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="#555"
          />
        </ReactFlow>

        <CustomControls />

        {/* Floating Top Left Controls (Name & Description) */}
        {!readonly && (
          <div className="absolute top-6 left-[72px] z-10 flex flex-col gap-3 w-80 pointer-events-none">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setEditorError(null);
                setIsDirty(true);
              }}
              className="w-full pointer-events-auto rounded-xl border bg-background/80 backdrop-blur-md border-tertiary/20 px-4 py-2.5 text-lg font-semibold text-foreground placeholder:text-tertiary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm"
              placeholder="Name your workflow"
            />
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setEditorError(null);
                setIsDirty(true);
              }}
              rows={2}
              className="w-full pointer-events-auto rounded-xl border bg-background/80 backdrop-blur-md border-tertiary/20 px-4 py-2.5 text-sm text-tertiary placeholder:text-tertiary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm resize-none"
              placeholder="Add a description..."
            />
          </div>
        )}

        {/* Floating Add Agent Button */}
        {!readonly && (
          <div className="absolute top-6 right-6 z-10 flex flex-col items-end gap-4">
            <button
              className="group p-3 rounded-2xl bg-primary/10 hover:bg-primary/20 transition-all flex items-center gap-3 text-left border border-primary/20 hover:border-primary/30 pointer-events-auto shadow-lg backdrop-blur-xl"
              onClick={() => handleAddNode()}
              onDragStart={onDragStart}
              draggable
            >
              <div className="p-2 rounded-xl bg-primary/15 text-primary group-hover:scale-105 transition-transform duration-300 shadow-sm shadow-primary/10">
                <Bot className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold text-foreground/80 group-hover:text-primary transition-colors">
                Add Agent
              </span>
            </button>
          </div>
        )}

        {!readonly && editorError && (
          <div className="absolute bottom-20 right-6 z-10 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-700 shadow-sm">
            {editorError}
          </div>
        )}

        {/* Floating Save Button at Bottom Right */}
        {!readonly && (
          <div className="absolute bottom-6 right-6 z-10 flex items-center gap-4 pointer-events-none">
            <div className="text-xs font-medium text-tertiary/60 bg-background/80 backdrop-blur px-3 py-1.5 rounded-full border border-tertiary/20 shadow-sm pointer-events-auto">
              {isDirty ? "Unsaved changes" : "All changes saved"}
            </div>
            <Button
              onClick={handleSave}
              disabled={!isDirty || !name || isSubmitting}
              className={cn(
                "pointer-events-auto px-6 h-11 rounded-xl font-medium transition-all gap-2",
                isDirty
                  ? "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105"
                  : "bg-tertiary/10 text-tertiary/50",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none",
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Workflow
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  if (props.richWorkflow) {
    return (
      <WorkflowCanvas
        workflow={props.richWorkflow}
        hasEditAccess={!props.readonly}
        autoRun={props.autoRun}
      />
    );
  }

  return (
    <ReactFlowProvider>
      <WorkflowEditorBody
        {...props}
        key={
          props.workflow
            ? `${props.workflow.id}:${props.workflow.updatedAt}`
            : "new"
        }
      />
    </ReactFlowProvider>
  );
}
