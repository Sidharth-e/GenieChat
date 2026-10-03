"use client";

import { cadencePreview, cadenceTimezone, formatInstant } from "@/lib/schedules/cadence";
import type { ScheduleCadence } from "@/lib/types";

/**
 * The next few runs, computed on every change.
 *
 * `cadencePreview` validates before it enumerates, so a half-typed expression is
 * the message below rather than a thrown error inside the render -- which is what
 * makes this safe to mount on a field the user is still typing in.
 */
export function CadencePreview({
  cadence,
  count = 3,
}: {
  cadence: ScheduleCadence;
  count?: number;
}) {
  const preview = cadencePreview(cadence, new Date(), count);

  if (!preview.ok) {
    return <p className="text-xs text-[var(--amber)]">{preview.message}</p>;
  }

  if (preview.runs.length === 0) {
    return <p className="text-xs text-text-secondary">This schedule has no next run.</p>;
  }

  const zone = cadenceTimezone(cadence);
  return (
    <div className="space-y-1">
      <p className="text-xs text-text-secondary">Next runs</p>
      <ul className="space-y-0.5 text-xs text-foreground">
        {preview.runs.map((run) => (
          <li key={run.toISOString()} className="font-mono">
            {formatInstant(run.toISOString(), zone)}
          </li>
        ))}
      </ul>
    </div>
  );
}
