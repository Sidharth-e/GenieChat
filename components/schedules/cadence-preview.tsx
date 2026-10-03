"use client";

import { cadencePreview, formatInstant, inViewerTimezone } from "@/lib/schedules/cadence";
import { useBrowserTimezone } from "@/hooks/use-browser-timezone";
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
  // Above the early returns, because a hook cannot be called after one has run.
  const viewerTimezone = useBrowserTimezone();
  // The occurrences and the text that describes them have to come from the same
  // zone, or this shows a time it did not compute: a cron cadence holding `UTC`
  // would yield UTC instants rendered in the viewer's zone, which is the same
  // mismatch one step further along. Stamping here rather than relying on the
  // caller means the preview cannot be handed an unstamped cadence.
  const preview = cadencePreview(
    inViewerTimezone(cadence, viewerTimezone),
    new Date(),
    count,
  );

  if (!preview.ok) {
    return <p className="text-xs text-[var(--amber)]">{preview.message}</p>;
  }

  if (preview.runs.length === 0) {
    return <p className="text-xs text-text-secondary">This schedule has no next run.</p>;
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-text-secondary">Next runs</p>
      <ul className="space-y-0.5 text-xs text-foreground">
        {preview.runs.map((run) => (
          <li key={run.toISOString()} className="font-mono">
            {formatInstant(run.toISOString(), viewerTimezone)}
          </li>
        ))}
      </ul>
    </div>
  );
}
