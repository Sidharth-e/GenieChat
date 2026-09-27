"use client";

import { useState, useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import type { HttpNodeData, HttpMethod, UINode, HttpValue } from "@/lib/workflow/types";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
const TABS = ["basic", "headers", "query", "body"] as const;

export function HttpNodeConfig({ data }: { data: HttpNodeData }) {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>("basic");
  const { updateNodeData } = useReactFlow<UINode>();

  const update = useCallback(
    (updates: Partial<HttpNodeData>) => updateNodeData(data.id, updates),
    [data.id, updateNodeData],
  );

  return (
    <div className="flex flex-col gap-3 px-4">
      <div className="flex border-b">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={cn(
              "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              tab === activeTab ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "basic" && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium mb-1">Method</p>
            <Select
              value={data.method}
              onChange={(v: string) => update({ method: v as HttpMethod })}
              options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
            />
          </div>
          <div>
            <p className="text-xs font-medium mb-1">URL</p>
            <Input
              value={typeof data.url === "string" ? data.url : ""}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://api.example.com/endpoint"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Timeout (ms)</p>
            <Input
              type="number"
              value={data.timeout || 30000}
              onChange={(e) => update({ timeout: parseInt(e.target.value) || 30000 })}
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {activeTab === "headers" && (
        <KeyValueEditor
          items={data.headers || []}
          onChange={(headers) => update({ headers })}
          addLabel="Add Header"
        />
      )}

      {activeTab === "query" && (
        <KeyValueEditor
          items={data.query || []}
          onChange={(query) => update({ query })}
          addLabel="Add Query Parameter"
        />
      )}

      {activeTab === "body" && (
        <div>
          {["POST", "PUT", "PATCH"].includes(data.method) ? (
            <textarea
              className="w-full min-h-[120px] text-sm bg-secondary border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-primary"
              value={typeof data.body === "string" ? data.body : ""}
              onChange={(e) => update({ body: e.target.value })}
              placeholder='{"key": "value"}'
            />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Body is not available for {data.method} requests.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function KeyValueEditor({
  items,
  onChange,
  addLabel,
}: {
  items: { key: string; value?: HttpValue }[];
  onChange: (items: { key: string; value?: HttpValue }[]) => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={item.key}
            onChange={(e) => {
              const updated = [...items];
              updated[index] = { ...updated[index], key: e.target.value };
              onChange(updated);
            }}
            placeholder="key"
            className="w-24 h-7 text-xs"
          />
          <Input
            value={typeof item.value === "string" ? item.value : ""}
            onChange={(e) => {
              const updated = [...items];
              updated[index] = { ...updated[index], value: e.target.value };
              onChange(updated);
            }}
            placeholder="value"
            className="flex-1 h-7 text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" className="w-full border-dashed text-muted-foreground text-xs" onClick={() => onChange([...items, { key: "", value: "" }])}>
        <Plus className="size-3" /> {addLabel}
      </Button>
    </div>
  );
}
