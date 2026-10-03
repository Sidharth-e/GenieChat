"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CadenceEditor } from "@/components/schedules/cadence-editor";
import { CadencePreview } from "@/components/schedules/cadence-preview";
import { ScheduleInputForm } from "@/components/schedules/schedule-input-form";
import { useAgents } from "@/hooks/use-agents-queries";
import { useWorkflows } from "@/hooks/use-workflows-queries";
import {
  useCreateSchedule,
  useSchedule,
  useUpdateSchedule,
} from "@/hooks/use-schedule-queries";
import { buildInputForm, coerceInputValues } from "@/lib/schedules/input-form";
import { targetInputSchema } from "@/lib/schedules/input-schemas";
import type { ScheduleCadence, TriggerTargetType } from "@/lib/types";

export interface ScheduleFormProps {
  scheduleId?: string;
  /** Pre-selected target, from the per-target block's "New schedule" link. */
  defaultTarget?: { type: TriggerTargetType; id: string };
}

/** The two kinds with an executor. `tool` arrives in phase 3. */
const TARGET_OPTIONS = [
  { value: "agent", label: "Agent" },
  { value: "workflow", label: "Workflow" },
];

const DEFAULT_CADENCE: ScheduleCadence = {
  kind: "cron",
  expression: "0 9 * * 1-5",
  timezone: "UTC",
};

export function ScheduleForm({ scheduleId, defaultTarget }: ScheduleFormProps) {
  const router = useRouter();
  const existing = useSchedule(scheduleId ?? null);
  const create = useCreateSchedule();
  const update = useUpdateSchedule(scheduleId ?? "");

  const { data: agents } = useAgents();
  const { data: workflows } = useWorkflows();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetType, setTargetType] = useState<TriggerTargetType>(
    defaultTarget?.type ?? "agent",
  );
  const [targetId, setTargetId] = useState(defaultTarget?.id ?? "");
  const [cadence, setCadence] = useState<ScheduleCadence>(DEFAULT_CADENCE);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [overlapPolicy, setOverlapPolicy] = useState<"skip" | "allow">("skip");
  const [catchUpPolicy, setCatchUpPolicy] = useState<"skip" | "once">("skip");
  const [enabled, setEnabled] = useState(true);
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The form fills from the loaded schedule exactly once, on the render where the
  // schedule first arrives. This is React's "adjust state when a prop changes"
  // pattern rather than an effect, for two reasons. An effect would commit a
  // frame of empty fields and then cascade a second render. And an effect keyed
  // on `targetType` would wipe what it had just written: hydrating sets the
  // target type, which is what would re-run it. Keying on the id instead means
  // only a *different* schedule re-fills the form, so a refetch -- and
  // react-query refetches on window focus by default -- cannot discard whatever
  // the user has typed since.
  if (existing.data && hydratedId !== existing.data.id) {
    const schedule = existing.data;
    setHydratedId(schedule.id);
    setName(schedule.name);
    setDescription(schedule.description ?? "");
    setTargetType(schedule.target.type);
    setTargetId(schedule.target.id);
    setCadence(schedule.cadence);
    setMaxAttempts(String(schedule.maxAttempts));
    setOverlapPolicy(schedule.overlapPolicy);
    setCatchUpPolicy(schedule.catchUpPolicy);
    setEnabled(schedule.enabled);
    // A stored input is the *parsed* object the API saved, and the form holds
    // strings. Anything that is not a scalar is round-tripped through the JSON
    // field rather than coerced into a string it would not survive.
    setInputValues(
      Object.fromEntries(
        Object.entries((schedule.input ?? {}) as Record<string, unknown>).map(
          ([key, value]) => [
            key,
            typeof value === "string" || typeof value === "number"
              ? String(value)
              : JSON.stringify(value),
          ],
        ),
      ),
    );
  }

  const schema = useMemo(() => targetInputSchema(targetType), [targetType]);
  const form = useMemo(() => (schema ? buildInputForm(schema) : null), [schema]);

  const targetOptions = ((targetType === "agent" ? agents : workflows) ?? []).map(
    (entry) => ({ value: entry.id, label: entry.name }),
  );

  const pending = create.isPending || update.isPending;

  async function submit() {
    setError(null);

    if (!name.trim()) return setError("Give the schedule a name.");
    if (!targetId) return setError("Choose what this schedule should run.");
    if (!form) return setError("That target cannot be scheduled yet.");

    const coerced = coerceInputValues(form, inputValues);
    if (!coerced.ok) return setError(coerced.message);

    // The same schema the API validates against, checked here so the user sees
    // the problem without a round trip. The server's check is still the authority.
    const parsedInput = schema?.safeParse(coerced.value);
    if (parsedInput && !parsedInput.success) {
      const first = parsedInput.error.issues[0];
      return setError(
        first ? `That input is not valid: ${first.message}` : "That input is not valid.",
      );
    }

    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      target: { type: targetType, id: targetId },
      input: coerced.value,
      cadence,
      enabled,
      overlapPolicy,
      catchUpPolicy,
      maxAttempts: Number(maxAttempts),
    };

    try {
      if (scheduleId) {
        await update.mutateAsync(body);
      } else {
        await create.mutateAsync(body);
      }
      router.push("/schedules");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="schedule-name" className="text-xs text-text-secondary">
            Name
          </label>
          <Input
            id="schedule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning digest"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="schedule-description" className="text-xs text-text-secondary">
            Description
          </label>
          <Textarea
            id="schedule-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this schedule is for"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg">What to run</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="schedule-target-type" className="text-xs text-text-secondary">
              Target type
            </label>
            <Select
              id="schedule-target-type"
              value={targetType}
              onChange={(value) => {
                // Changing the target type replaces the input form, so the values
                // that belonged to the old schema are dropped here rather than
                // submitted against the new one. It happens in the handler that
                // changes the type, not in an effect watching it, because the
                // hydrate step above also sets the type -- and an effect would
                // have wiped the input it had just loaded from the schedule.
                setTargetType(value as TriggerTargetType);
                setTargetId("");
                setInputValues({});
              }}
              options={TARGET_OPTIONS}
              size="sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-target-id" className="text-xs text-text-secondary">
              Target
            </label>
            <Select
              id="schedule-target-id"
              value={targetId}
              onChange={setTargetId}
              options={targetOptions}
              placeholder="Choose a target"
              searchable
              size="sm"
            />
          </div>
        </div>

        {form && (
          <ScheduleInputForm
            fields={form.fields}
            values={inputValues}
            onChange={(field, value) =>
              setInputValues((current) => ({ ...current, [field]: value }))
            }
            idPrefix="schedule-input"
          />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg">When to run</h2>
        <CadenceEditor value={cadence} onChange={setCadence} idPrefix="schedule-cadence" />
        <CadencePreview cadence={cadence} />
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg">How to run it</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="schedule-attempts" className="text-xs text-text-secondary">
              Attempts
            </label>
            <Input
              id="schedule-attempts"
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-overlap" className="text-xs text-text-secondary">
              If a run is still going
            </label>
            <Select
              id="schedule-overlap"
              value={overlapPolicy}
              onChange={(value) => setOverlapPolicy(value as "skip" | "allow")}
              options={[
                { value: "skip", label: "Skip this occurrence" },
                { value: "allow", label: "Run anyway" },
              ]}
              size="sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="schedule-catchup" className="text-xs text-text-secondary">
              If a window was missed
            </label>
            <Select
              id="schedule-catchup"
              value={catchUpPolicy}
              onChange={(value) => setCatchUpPolicy(value as "skip" | "once")}
              options={[
                { value: "skip", label: "Skip it" },
                { value: "once", label: "Run it once" },
              ]}
              size="sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            id="schedule-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <label htmlFor="schedule-enabled">Enabled</label>
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-card-border bg-card-bg p-3 text-sm text-[var(--red)]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {scheduleId ? "Save changes" : "Create schedule"}
        </Button>
        <Button variant="ghost" onClick={() => router.push("/schedules")} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
