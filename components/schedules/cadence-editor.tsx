"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useBrowserTimezone } from "@/hooks/use-browser-timezone";
import type { ScheduleCadence } from "@/lib/types";

interface CadenceEditorProps {
  value: ScheduleCadence;
  onChange: (value: ScheduleCadence) => void;
  /** Prefixed onto input ids so two editors on one page cannot collide. */
  idPrefix: string;
}

/**
 * The kind of cadence, and the fields that describe it.
 *
 * There is deliberately no timezone control. Every instant in this subsystem is
 * authored and displayed in the browser's own zone, so the zone is resolved from
 * the browser and stamped onto the cadence here rather than offered as a second
 * clock for the user to reconcile — an expression typed against their own clock
 * but filed under a different zone fires at an hour they never picked. The zone
 * in use is named below the fields, so it is still visible, just not a choice.
 */
export function CadenceEditor({ value, onChange, idPrefix }: CadenceEditorProps) {
  const viewerTimezone = useBrowserTimezone();
  const kindOptions = [
    { value: "cron", label: "Repeats" },
    { value: "once", label: "Once" },
  ];

  return (
    <div className="space-y-3">
      <Select
        id={`${idPrefix}-kind`}
        value={value.kind}
        onChange={(kind) =>
          onChange(
            kind === "once"
              ? {
                  kind: "once",
                  runAt: new Date(Date.now() + 3_600_000).toISOString(),
                }
              : {
                  kind: "cron",
                  expression: "0 9 * * 1-5",
                  timezone: viewerTimezone,
                },
          )
        }
        options={kindOptions}
        size="sm"
      />

      {value.kind === "cron" ? (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-expression`} className="text-xs text-text-secondary">
            Cron expression
          </label>
          <Input
            id={`${idPrefix}-expression`}
            value={value.expression}
            onChange={(e) => onChange({ ...value, expression: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="font-mono"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-runAt`} className="text-xs text-text-secondary">
            Run at
          </label>
          <Input
            id={`${idPrefix}-runAt`}
            type="datetime-local"
            value={toLocalInputValue(value.runAt)}
            onChange={(e) => {
              // `datetime-local` is a wall-clock string with no zone, and the
              // browser reads it in the browser's zone. Converting here means the
              // stored instant is the one the user's clock showed, whatever the
              // server's zone is.
              const parsed = new Date(e.target.value);
              if (!Number.isNaN(parsed.getTime())) {
                onChange({ kind: "once", runAt: parsed.toISOString() });
              }
            }}
          />
        </div>
      )}

      <p className="text-xs text-text-secondary">
        Times are in {viewerTimezone}, your browser&apos;s timezone.
      </p>
    </div>
  );
}

/** An ISO instant as the local wall-clock string `datetime-local` expects. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
