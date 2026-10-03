"use client";

import { useCallback, useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import {
  Check,
  X,
  Loader2,
  Play,
  Copy,
  CheckCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { NodeIcon } from "@/components/workflow/node-icon";
import { useWorkflowEditorStore } from "@/lib/stores/workflow-editor";
import { allNodeValidate } from "@/lib/workflow/node-validate";
import {
  NodeKind,
  type UINode,
  type NodeRuntimeHistory,
  type ObjectJsonSchema7,
  type JsonSchema7,
  type WorkflowStreamEvent,
} from "@/lib/workflow/types";

interface ExecuteTabProps {
  close: () => void;
  onSave: () => Promise<void>;
}

export function ExecuteTab({ close, onSave }: ExecuteTabProps) {
  const [tab, setTab] = useState<"input" | "result">("input");
  const [isRunning, setIsRunning] = useState(false);
  const [query, setQuery] = useState<Record<string, unknown>>({});
  const [histories, setHistories] = useState<NodeRuntimeHistory[]>([]);
  const [result, setResult] = useState<
    { output?: unknown; error?: string } | undefined
  >();
  const [copied, setCopied] = useState(false);

  const { getNodes, getEdges, setNodes, updateNodeData, getNode } =
    useReactFlow<UINode>();
  const { workflow, addProcess } = useWorkflowEditorStore();

  // Find the Input node and extract its output schema
  const inputNode = getNodes().find((n) => n.data.kind === NodeKind.Input);
  const inputSchema: ObjectJsonSchema7 | undefined = inputNode?.data
    .outputSchema as ObjectJsonSchema7 | undefined;
  const properties = inputSchema?.properties ?? {};
  const requiredFields = useMemo(
    () => inputSchema?.required ?? [],
    [inputSchema],
  );

  const handleStreamEvent = useCallback(
    (event: WorkflowStreamEvent) => {
      switch (event.eventType) {
        case "NODE_START": {
          const nodeId = event.nodeId || event.node?.name;
          if (!nodeId) break;
          const uiNode = getNode(nodeId);
          if (!uiNode) break;
          updateNodeData(uiNode.id, {
            runtime: { status: "running" },
          });
          setHistories((prev) => [
            ...prev,
            {
              id: event.nodeExecutionId || crypto.randomUUID(),
              nodeId: uiNode.id,
              name: uiNode.data.name,
              kind: uiNode.data.kind,
              startedAt: Date.now(),
              status: "running",
            },
          ]);
          break;
        }
        case "NODE_END": {
          const nodeId = event.nodeId;
          const status = event.isOk ? "success" : "fail";
          updateNodeData(nodeId, { runtime: { status } });
          setHistories((prev) =>
            prev.map((h) => {
              if (
                h.id !== (event.nodeExecutionId || "") &&
                h.nodeId !== nodeId
              )
                return h;
              if (h.status !== "running") return h;
              return {
                ...h,
                endedAt: Date.now(),
                status: status as "success" | "fail",
                error: event.error,
                result: { output: event.output, input: event.input },
              };
            }),
          );
          break;
        }
        case "WORKFLOW_END": {
          // A failed run reports its reason here rather than by throwing, so the
          // tab reads it from the event. On success the output comes from the
          // Output node's history entry, below.
          if (!event.isOk) {
            setResult((prev) => ({
              ...prev,
              error: event.error ?? "Execution failed",
            }));
          }
          break;
        }
      }
    },
    [getNode, updateNodeData],
  );

  const run = useCallback(
    async (queryData: Record<string, unknown>) => {
      if (!workflow) {
        toast.error("No workflow loaded");
        return;
      }

      const stop = addProcess();
      setHistories([]);
      setResult(undefined);
      setIsRunning(true);
      setTab("result");

      // Clear runtime status on all nodes
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: { ...node.data, runtime: undefined },
        })),
      );

      try {
        const response = await fetch(
          `/api/workflows/${workflow.id}/execute`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: queryData }),
          },
        );

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No readable stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // Parse SSE-style newline-delimited JSON events
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              handleStreamEvent(event);
            } catch {
              /* skip malformed lines */
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            handleStreamEvent(event);
          } catch {
            /* skip malformed */
          }
        }

        // Extract final result from output node histories
        setHistories((prev) => {
          const outputHistories = prev.filter(
            (h) => h.kind === NodeKind.Output && h.result?.output != null,
          );
          if (outputHistories.length > 0) {
            const lastOutput =
              outputHistories[outputHistories.length - 1].result?.output;
            setResult((prev) => ({ ...prev, output: lastOutput }));
          }
          return prev;
        });
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          toast.error(`Execution failed: ${error.message}`);
          setResult({ error: (error as Error).message });
        }
      } finally {
        stop();
        setIsRunning(false);
      }
    },
    [workflow, addProcess, setNodes, handleStreamEvent],
  );

  const handleRun = useCallback(async () => {
    // Save workflow first
    try {
      await onSave();
    } catch {
      toast.error("Failed to save workflow before execution");
      return;
    }

    // Validate required fields
    for (const field of requiredFields) {
      if (
        query[field] === undefined ||
        query[field] === null ||
        query[field] === ""
      ) {
        toast.error(`Required field "${field}" is missing`);
        return;
      }
    }

    // Validate nodes
    const nodes = getNodes() as UINode[];
    const edges = getEdges();
    const validation = allNodeValidate({ nodes, edges });
    if (validation !== true) {
      toast.error(validation.errorMessage);
      return;
    }

    await run(query);
  }, [onSave, requiredFields, query, getNodes, getEdges, run]);

  const handleCopy = useCallback(async () => {
    const outputHistories = histories
      .filter((h) => h.kind === NodeKind.Output)
      .map((h) => h.result?.output)
      .filter(Boolean);
    const data =
      outputHistories.length === 1 ? outputHistories[0] : outputHistories;
    const text = result?.output
      ? JSON.stringify(result.output, null, 2)
      : JSON.stringify(data, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [histories, result]);

  const updateField = useCallback((key: string, value: unknown) => {
    setQuery((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="w-sm h-[85vh] bg-card border rounded-lg shadow-lg overflow-y-auto py-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-3">
        <h3 className="text-sm font-semibold">Test Run</h3>
        <Button variant="ghost" size="icon-sm" onClick={close}>
          <X className="size-4" />
        </Button>
      </div>

      <Separator />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3">
        <button
          onClick={() => setTab("input")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
            tab === "input"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Input
        </button>
        <button
          onClick={() => setTab("result")}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
            tab === "result"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Result
        </button>
      </div>

      {/* Tab content */}
      <div className="px-4 pt-4">
        {tab === "input" && (
          <InputTab
            properties={properties}
            requiredFields={requiredFields}
            query={query}
            updateField={updateField}
            onRun={handleRun}
            isRunning={isRunning}
          />
        )}
        {tab === "result" && (
          <ResultTab
            histories={histories}
            result={result}
            isRunning={isRunning}
            copied={copied}
            onCopy={handleCopy}
          />
        )}
      </div>
    </div>
  );
}

// --- Input Tab ---

function InputTab({
  properties,
  requiredFields,
  query,
  updateField,
  onRun,
  isRunning,
}: {
  properties: Record<string, JsonSchema7>;
  requiredFields: string[];
  query: Record<string, unknown>;
  updateField: (key: string, value: unknown) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          No input fields defined. Add fields to the Input node to test your
          workflow.
        </p>
        <Button onClick={onRun} disabled={isRunning} className="w-full">
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {isRunning ? "Running..." : "Run"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map(([key, schema]) => {
        const isRequired = requiredFields.includes(key);
        return (
          <FieldInput
            key={key}
            name={key}
            schema={schema}
            isRequired={isRequired}
            value={query[key]}
            onChange={(val) => updateField(key, val)}
          />
        );
      })}
      <Button onClick={onRun} disabled={isRunning} className="w-full">
        {isRunning ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {isRunning ? "Running..." : "Run"}
      </Button>
    </div>
  );
}

// --- Field Input ---

function FieldInput({
  name,
  schema,
  isRequired,
  value,
  onChange,
}: {
  name: string;
  schema: JsonSchema7;
  isRequired: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <label className="text-sm font-medium">
      {name}
      {isRequired && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );

  // Enum string -> Select
  if (schema.type === "string" && Array.isArray(schema.enum)) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Select
          value={(value as string) ?? ""}
          onChange={onChange}
          options={schema.enum.map((v) => ({
            value: v as string,
            label: v as string,
          }))}
          placeholder={`Select ${name}`}
        />
      </div>
    );
  }

  // Boolean -> toggle button
  if (schema.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-2">
        {label}
        <Button
          variant={value ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(!value)}
        >
          {value ? "True" : "False"}
        </Button>
      </div>
    );
  }

  // Number -> number input
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Input
          type="number"
          value={(value as string) ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
          placeholder={schema.description || `Enter ${name}`}
          className="h-9"
        />
      </div>
    );
  }

  // Default: string -> Textarea
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <Textarea
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={schema.description || `Enter ${name}`}
        rows={3}
        className="rounded-lg border border-tertiary/20 bg-secondary/50"
      />
    </div>
  );
}

// --- Result Tab ---

function ResultTab({
  histories,
  result,
  isRunning,
  copied,
  onCopy,
}: {
  histories: NodeRuntimeHistory[];
  result: { output?: unknown; error?: string } | undefined;
  isRunning: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Node execution history */}
      {histories.length === 0 && !isRunning && !result?.error && (
        <p className="text-sm text-muted-foreground">
          Run the workflow to see execution results.
        </p>
      )}

      {histories.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Execution Steps
          </p>
          {histories.map((h) => (
            <HistoryItem key={h.id} history={h} />
          ))}
        </div>
      )}

      {isRunning && histories.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Starting execution...
        </div>
      )}

      {/* The run's failure reason. Deliberately outside the result section
          below, because a run can fail before any node executes — compiling a
          node with no inbound edge throws first — so there is no history to
          gate on and the reason would otherwise never be drawn. */}
      {result?.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">{result.error}</p>
        </div>
      )}

      {/* Result section */}
      {(result || !isRunning) && histories.length > 0 && (
        <>
          <Separator />

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Result</p>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCopy}
              disabled={!result}
            >
              {copied ? (
                <CheckCheck className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>

          {result?.output != null && (
            <pre className="rounded-lg border bg-secondary/50 p-3 text-xs overflow-x-auto max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words">
              {typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output, null, 2)}
            </pre>
          )}

          {!result && !isRunning && histories.length > 0 && (
            <p className="text-sm text-muted-foreground">
              No output was produced.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// --- History Item ---

function HistoryItem({ history }: { history: NodeRuntimeHistory }) {
  const timing =
    history.endedAt && history.startedAt
      ? ((history.endedAt - history.startedAt) / 1000).toFixed(2)
      : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm px-2 py-1.5 rounded-md",
        history.status === "fail" && "text-destructive",
      )}
    >
      <NodeIcon type={history.kind} className="shrink-0" />
      <span className="flex-1 truncate">{history.name}</span>
      {timing && (
        <span className="text-xs text-muted-foreground shrink-0">
          {timing}s
        </span>
      )}
      <StatusIcon status={history.status} />
    </div>
  );
}

function StatusIcon({ status }: { status: NodeRuntimeHistory["status"] }) {
  switch (status) {
    case "running":
      return (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
      );
    case "success":
      return <Check className="size-3.5 text-green-500 shrink-0" />;
    case "fail":
      return <X className="size-3.5 text-destructive shrink-0" />;
  }
}
