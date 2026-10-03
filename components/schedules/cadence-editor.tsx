"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ScheduleCadence } from "@/lib/types";

/**
 * The zones offered.
 *
 * A short list with the browser's own zone first, rather than an IANA picker: the
 * overwhelming majority of schedules are "when I am at work", and the full list is
 * six hundred entries. `Intl` resolves the browser's zone, and `validateCadence`
 * accepts any real zone -- so a hand-built cadence from the API is not limited to
 * this list.
 */
function zoneOptions(): { value: string; label: string }[] {
  let local = "UTC";
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    local = "UTC";
  }
  const zones = Array.from(
    new Set([
      local,
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Australia/Sydney",
    ]),
  );
  return zones.map((zone) => ({
    value: zone,
    label: zone === local ? `${zone} (your timezone)` : zone,
  }));
}

interface CadenceEditorProps {
  value: ScheduleCadence;
  onChange: (value: ScheduleCadence) => void;
  /** Prefixed onto input ids so two editors on one page cannot collide. */
  idPrefix: string;
}

export function CadenceEditor({ value, onChange, idPrefix }: CadenceEditorProps) {
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
              ? { kind: "once", runAt: new Date(Date.now() + 3_600_000).toISOString() }
              : { kind: "cron", expression: "0 9 * * 1-5", timezone: zoneOptions()[0].value },
          )
        }
        options={kindOptions}
        size="sm"
      />

      {value.kind === "cron" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
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
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-timezone`} className="text-xs text-text-secondary">
              Timezone
            </label>
            <Select
              id={`${idPrefix}-timezone`}
              value={value.timezone}
              onChange={(timezone) => onChange({ ...value, timezone })}
              options={zoneOptions()}
              searchable
              size="sm"
            />
          </div>
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
