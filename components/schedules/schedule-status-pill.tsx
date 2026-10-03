import type { ScheduleRunStatus } from "@/lib/types";

/**
 * Status to colour, in the design system's pill classes.
 *
 * `skipped` and `cancelled` draw their own neutral chip rather than borrowing a
 * `.pill-*` class, because none of the five means "nothing happened": amber is
 * waiting, and a skipped run is not waiting for anything.
 */
const PILL_CLASS: Record<ScheduleRunStatus, string> = {
  pending: "pill-amber",
  running: "pill-blue",
  succeeded: "pill-green",
  failed: "pill-red",
  skipped:
    "rounded-full border border-card-border px-2 py-0.5 text-xs text-text-secondary",
  cancelled:
    "rounded-full border border-card-border px-2 py-0.5 text-xs text-text-secondary",
};

const LABEL: Record<ScheduleRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export function ScheduleStatusPill({ status }: { status: ScheduleRunStatus }) {
  return <span className={PILL_CLASS[status]}>{LABEL[status]}</span>;
}
