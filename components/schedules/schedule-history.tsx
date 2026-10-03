"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScheduleStatusPill } from "@/components/schedules/schedule-status-pill";
import {
  useRunSchedule,
  useScheduleRun,
  useScheduleRuns,
} from "@/hooks/use-schedule-queries";
import { formatInstant } from "@/lib/schedules/cadence";
import { isRunOpen } from "@/lib/schedules/retry";
import { useBrowserTimezone } from "@/hooks/use-browser-timezone";

const PAGE_SIZE = 20;

function duration(run: { durationMs?: number }): string {
  if (!run.durationMs) return "—";
  if (run.durationMs < 1000) return `${run.durationMs}ms`;
  return `${(run.durationMs / 1000).toFixed(1)}s`;
}

export function ScheduleHistory({ scheduleId }: { scheduleId: string }) {
  const [offset, setOffset] = useState(0);
  const [watchedRunId, setWatchedRunId] = useState<string | null>(null);

  const { data, isLoading, error } = useScheduleRuns(scheduleId, {
    limit: PAGE_SIZE,
    offset,
  });
  const runNow = useRunSchedule();
  // The run "Run now" just created, polled so its status changes on screen without
  // a manual refresh. The list itself refetches on the mutation's success.
  const watched = useScheduleRun(scheduleId, watchedRunId);

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const viewerTimezone = useBrowserTimezone();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg">Run history</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={runNow.isPending}
          onClick={() =>
            runNow.mutate(scheduleId, {
              onSuccess: ({ runId }) => {
                setWatchedRunId(runId);
                setOffset(0);
              },
            })
          }
        >
          Run now
        </Button>
      </div>

      {watched.data && isRunOpen(watched.data.status) && (
        <p className="text-xs text-text-secondary">
          Your manual run is {watched.data.status}…
        </p>
      )}

      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {error && (
        <p className="rounded-lg border border-card-border bg-card-bg p-3 text-sm text-[var(--red)]">
          {error.message}
        </p>
      )}

      {!isLoading && !error && runs.length === 0 && (
        <p className="text-sm text-text-secondary">
          No runs yet. This schedule has not fired.
        </p>
      )}

      {runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs text-text-secondary">
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Scheduled for</th>
                <th className="py-2 pr-3 font-medium">Duration</th>
                <th className="py-2 pr-3 font-medium">Attempt</th>
                <th className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-card-border align-top">
                  <td className="py-2 pr-3">
                    <ScheduleStatusPill status={run.status} />
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {formatInstant(run.scheduledFor, viewerTimezone)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-text-secondary">
                    {duration(run)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-text-secondary">
                    {run.attempt}/{run.maxAttempts}
                  </td>
                  <td className="py-2 text-xs">
                    {run.error && (
                      <span className="text-[var(--red)]">
                        {run.error.code}: {run.error.message}
                      </span>
                    )}
                    {run.resultRef?.threadId && (
                      <Link
                        href={`/agent-chat/${run.target.id}/${run.resultRef.threadId}`}
                        className="text-[var(--blue)] underline-offset-2 hover:underline"
                      >
                        Open conversation
                      </Link>
                    )}
                    {run.resultRef?.outputPreview && !run.resultRef.threadId && (
                      <span className="text-text-secondary">
                        {run.resultRef.outputPreview.slice(0, 120)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
