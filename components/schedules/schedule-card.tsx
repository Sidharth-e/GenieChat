"use client";

import Link from "next/link";
import { CalendarClock, Play, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduleStatusPill } from "@/components/schedules/schedule-status-pill";
import { describeCadence, formatInstant } from "@/lib/schedules/cadence";
import type { ScheduleListItem } from "@/hooks/use-schedule-queries";
import { useBrowserTimezone } from "@/hooks/use-browser-timezone";

interface ScheduleCardProps {
  schedule: ScheduleListItem;
  onRunNow: () => void;
  onDelete: () => void;
  /** While a "Run now" request is in flight, so a double click cannot fire two. */
  isRunning: boolean;
}

/** The next run, in the viewer's zone -- the one zone this UI shows times in. */
function nextRunLabel(
  schedule: ScheduleListItem,
  viewerTimezone: string,
): string {
  if (!schedule.nextRunAt) return "No next run";
  const at = formatInstant(schedule.nextRunAt, viewerTimezone);
  return schedule.enabled ? at : `Paused — would run ${at}`;
}

export function ScheduleCard({
  schedule,
  onRunNow,
  onDelete,
  isRunning,
}: ScheduleCardProps) {
  const viewerTimezone = useBrowserTimezone();
  const target = schedule.targetName ?? schedule.target.id;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-card-border bg-card-bg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground">{schedule.name}</h3>
            {schedule.lastRunStatus && <ScheduleStatusPill status={schedule.lastRunStatus} />}
            {!schedule.enabled && (
              <span className="text-xs text-text-secondary">Paused</span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-text-secondary">
            {schedule.target.type} · {target}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Run now"
            aria-label={`Run ${schedule.name} now`}
            disabled={isRunning}
            onClick={onRunNow}
          >
            <Play />
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={`/schedules/${schedule.id}/edit`} aria-label={`Edit ${schedule.name}`}>
              <Pencil />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${schedule.name}`}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          {describeCadence(schedule.cadence, viewerTimezone)}
        </span>
        <span>{nextRunLabel(schedule, viewerTimezone)}</span>
        {schedule.skippedRuns > 0 && <span>{schedule.skippedRuns} skipped</span>}
      </div>
    </div>
  );
}
