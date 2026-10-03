"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RichWorkflow, WorkflowTrigger } from "@/lib/types";

const TRIGGER_TYPES: { value: WorkflowTrigger["type"]; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "webhook", label: "Webhook" },
  { value: "schedule", label: "Schedule" },
];

export function WorkflowTriggerPanel({ workflow }: { workflow: RichWorkflow }) {
  const initial: WorkflowTrigger = workflow.trigger ?? { type: "manual" };

  // `draft` is what the form edits; `saved` is what the server has. The button
  // label reads `saved` rather than the `workflow` prop, so a successful save is
  // visible without a reload — the prop only changes when the parent re-renders.
  const [draft, setDraft] = useState<WorkflowTrigger>(initial);
  const [saved, setSaved] = useState<WorkflowTrigger>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // A partial body is safe: `updateRichWorkflow` drops `undefined` keys
        // before the merge, so the fields this omits keep their stored values.
        body: JSON.stringify({ trigger: draft }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save the trigger");
      }
      setSaved(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the trigger");
    } finally {
      setSaving(false);
    }
  };

  const setConfig = (patch: Partial<NonNullable<WorkflowTrigger["config"]>>) =>
    setDraft((current) => ({
      ...current,
      config: { ...current.config, ...patch },
    }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Trigger: {saved.type}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-4 space-y-3">
        <div className="space-y-1">
          {/* No `@/components/ui/label` primitive exists in this repo — a
              plain `<label>` is the house pattern (see
              `node-config/execute-tab.tsx:409`). */}
          <label className="text-sm font-medium">Trigger</label>
          <select
            className="w-full rounded-sm border border-input-border bg-input-bg px-2 py-1 text-sm"
            value={draft.type}
            onChange={(event) => {
              const type = event.target.value as WorkflowTrigger["type"];
              setDraft({ type, config: draft.config });
            }}
          >
            {TRIGGER_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        {draft.type === "webhook" && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Secret</label>
            <Input
              value={draft.config?.webhookSecret ?? ""}
              onChange={(event) =>
                setConfig({ webhookSecret: event.target.value })
              }
              placeholder="Shared secret sent as a Bearer token"
            />
          </div>
        )}

        {draft.type === "schedule" && (
          <div className="space-y-1">
            <label className="text-sm font-medium">Cron expression</label>
            <Input
              value={draft.config?.cronExpression ?? ""}
              onChange={(event) =>
                setConfig({ cronExpression: event.target.value })
              }
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Evaluated by <code>POST /api/cron</code>.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-[var(--red)]">{error}</p>}

        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save trigger"}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
