"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduleStatusPill } from "@/components/schedules/schedule-status-pill";
import { useSchedules } from "@/hooks/use-schedule-queries";
import { describeCadence } from "@/lib/schedules/cadence";
import type { TriggerTargetType } from "@/lib/types";

/**
 * The schedules that point at one target, shown on that target's own page.
 *
 * Read through the filter rather than by fetching everything and filtering here:
 * the API's `target.type`/`target.id` filter is what keeps this block from
 * loading a user's whole schedule list to draw three rows.
 */
export function TargetSchedules({
  targetType,
  targetId,
}: {
  targetType: TriggerTargetType;
  targetId: string;
}) {
  const { data, isLoading } = useSchedules({ targetType, targetId });
  const schedules = data ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg">Schedules</h2>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/schedules/new?target.type=${targetType}&target.id=${targetId}`}>
            <Plus /> New schedule
          </Link>
        </Button>
      </div>

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!isLoading && schedules.length === 0 && (
        <p className="text-sm text-text-secondary">
          This {targetType} is not on a schedule yet.
        </p>
      )}

      {schedules.length > 0 && (
        <ul className="divide-y divide-card-border rounded-lg border border-card-border">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <Link
                href={`/schedules/${schedule.id}/edit`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-hover-bg"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">
                    {schedule.name}
                  </span>
                  <span className="block truncate text-xs text-text-secondary">
                    {describeCadence(schedule.cadence)}
                    {!schedule.enabled && " · paused"}
                  </span>
                </span>
                {schedule.lastRunStatus && (
                  <ScheduleStatusPill status={schedule.lastRunStatus} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
