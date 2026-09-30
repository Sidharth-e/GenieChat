import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Bot, Play, LogOut, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";

interface Agent {
  id: string;
  name: string;
}

interface NodeChangeHandler {
  (id: string, changes: Record<string, string>): void;
}

interface AgentNodeProps {
  data: {
    id: string;
    name?: string;
    agentId?: string;
    input?: string;
    status?: "completed" | "error" | "running";
    agents?: Agent[];
    readonly?: boolean;
    onChange?: NodeChangeHandler;
    onDelete?: (id: string) => void;
  };
  isConnectable?: boolean;
}

interface TriggerNodeProps {
  data: {
    id: string;
    triggerType?: string;
    webhookSecret?: string;
    cronExpression?: string;
    readonly?: boolean;
    onChange?: NodeChangeHandler;
  };
}

interface OutputNodeProps {
  data: {
    id: string;
    outputType?: string;
    readonly?: boolean;
    onChange?: NodeChangeHandler;
  };
}

const nodeStyles = {
  trigger: "border-blue-500/50 bg-blue-500/10 text-blue-500",
  agent: "border-primary/50 bg-primary/10 text-primary",
  output: "border-green-500/50 bg-green-500/10 text-green-500",
};

export const AgentNode = memo(({ data, isConnectable }: AgentNodeProps) => {
  return (
    <div
      className={cn(
        "wf-node min-w-[228px] group",
        data.status === 'completed' && "wf-node-success",
        data.status === 'error' && "wf-node-fail",
        data.status === 'running' && "wf-node-running animate-pulse"
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="!w-3 !h-3 !border-2 !border-background !bg-primary"
      />

      <div className="wf-node-header wf-node-header-accent">
        <div className={cn("p-1.5 rounded-lg flex items-center justify-center shadow-sm", nodeStyles.agent)}>
          <Bot className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 font-bold text-[13px] wf-text">Agent Step</div>
        <GripVertical className="w-3.5 h-3.5 wf-text-faint cursor-grab group-hover:opacity-70 transition-opacity" />
        {data.onDelete && !data.readonly && (
          <button
            onClick={() => data.onDelete?.(data.id)}
            className="p-1 rounded-lg wf-text-faint hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete Node"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="wf-label">Step Name</label>
          <input
            className="nodrag wf-input"
            value={data.name || ""}
            disabled={data.readonly}
            onChange={(e) => data.onChange && data.onChange(data.id, { name: e.target.value })}
            placeholder="New Step"
          />
        </div>
        <div>
          <label className="wf-label">Agent</label>
          <Select
            className="nodrag"
            value={data.agentId || ""}
            disabled={data.readonly}
            onChange={(v) => data.onChange?.(data.id, { agentId: v })}
            options={(data.agents || []).map((agent) => ({
              value: agent.id,
              label: agent.name,
            }))}
            placeholder="Select an agent"
            size="sm"
          />
        </div>
        <div>
          <label className="wf-label">Input</label>
          <textarea
            className="nodrag wf-input min-h-[52px] resize-none"
            value={data.input || ""}
            disabled={data.readonly}
            onChange={(e) => data.onChange?.(data.id, { input: e.target.value })}
            placeholder="Custom instructions or input..."
          />
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="!w-3 !h-3 !border-2 !border-background !bg-primary"
      />
    </div>
  );
});
AgentNode.displayName = "AgentNode";

export const TriggerNode = memo(({ data }: TriggerNodeProps) => {
  return (
    <div className="wf-node wf-node-blue min-w-[196px] group">
      <div className="wf-node-header wf-node-header-blue">
        <div className={cn("p-1.5 rounded-lg flex items-center justify-center shadow-sm", nodeStyles.trigger)}>
          <Play className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 font-bold text-[13px] wf-text">Trigger</div>
      </div>
      <div className="p-4 space-y-3.5">
        <div>
          <label className="wf-label">Trigger Type</label>
          <Select
            className="nodrag"
            value={data.triggerType || "manual"}
            disabled={data.readonly}
            onChange={(v) => data.onChange && data.onChange(data.id, { triggerType: v })}
            options={[
              { value: "manual", label: "Manual" },
              { value: "webhook", label: "Webhook" },
              { value: "schedule", label: "Schedule (Cron)" },
            ]}
            size="sm"
          />
        </div>

        {data.triggerType === "webhook" && (
          <div>
            <label className="wf-label">Webhook Secret</label>
            <input
              type="text"
              className="nodrag wf-input"
              value={data.webhookSecret || ""}
              disabled={data.readonly}
              onChange={(e) => data.onChange && data.onChange(data.id, { webhookSecret: e.target.value })}
              placeholder="Optional secret token"
            />
          </div>
        )}

        {data.triggerType === "schedule" && (
          <div>
            <label className="wf-label">Cron Expression</label>
            <input
              type="text"
              className="nodrag wf-input"
              value={data.cronExpression || ""}
              onChange={(e) => data.onChange && data.onChange(data.id, { cronExpression: e.target.value })}
              placeholder="e.g. 0 0 * * *"
            />
          </div>
        )}
      </div>
    </div>
  );
});
TriggerNode.displayName = "TriggerNode";

export const OutputNode = memo(({ data }: OutputNodeProps) => {
    return (
      <div className="wf-node wf-node-green min-w-[220px] group">
        <div className="wf-node-header wf-node-header-green">
          <div className={cn("p-1.5 rounded-lg flex items-center justify-center shadow-sm", nodeStyles.output)}>
            <LogOut className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 font-bold text-[13px] wf-text">Output</div>
        </div>
        <div className="p-4 space-y-2.5">
          <div>
            <label className="wf-label">Output Type</label>
            <Select
              className="nodrag"
              value={data.outputType || "markdown"}
              disabled={data.readonly}
              onChange={(v) => data.onChange && data.onChange(data.id, { outputType: v })}
              options={[
                { value: "markdown", label: "Markdown" },
                { value: "text", label: "Plain Text" },
                { value: "json", label: "JSON" },
              ]}
              size="sm"
            />
          </div>

          <div className="text-xs wf-text-muted font-medium">
            Ends the workflow
          </div>
        </div>
      </div>
    );
  });
OutputNode.displayName = "OutputNode";
