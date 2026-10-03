"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ContentLayout } from "@/components/common/content-layout";
import {
  ContentFilterPills,
  type ContentFilterPill,
} from "@/components/common/content-filter-pills";
import { Button } from "@/components/ui/button";
import { ScheduleCard } from "@/components/schedules/schedule-card";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import {
  useDeleteSchedule,
  useRunSchedule,
  useSchedules,
  type ScheduleListItem,
} from "@/hooks/use-schedule-queries";

type ScheduleTab = "all" | "enabled" | "paused";

const TABS: readonly ContentFilterPill<ScheduleTab>[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "paused", label: "Paused" },
];

export function SchedulesContent() {
  const [tab, setTab] = useState<ScheduleTab>("all");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ScheduleListItem | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // One unfiltered read, filtered in memory. Tab switching and typing must not
  // each be a round trip, and a user's own schedules are a bounded list.
  const { data, isLoading, error } = useSchedules();
  const runNow = useRunSchedule();
  const remove = useDeleteSchedule();

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data ?? []).filter((schedule) => {
      if (tab === "enabled" && !schedule.enabled) return false;
      if (tab === "paused" && schedule.enabled) return false;
      if (!needle) return true;
      return (
        schedule.name.toLowerCase().includes(needle) ||
        (schedule.targetName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, tab, search]);

  return (
    <ContentLayout
      title="Schedules"
      description="Run an agent or a workflow on a cadence, with a record of every attempt."
      searchPlaceholder="Search schedules..."
      searchValue={search}
      onSearchChange={setSearch}
      actionButton={
        <Button asChild>
          <Link href="/schedules/new">
            <Plus /> New schedule
          </Link>
        </Button>
      }
      navigation={
        <ContentFilterPills
          ariaLabel="Filter schedules"
          options={TABS}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-card-border bg-card-bg"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-card-border bg-card-bg p-4 text-sm text-[var(--red)]">
          {error.message}
        </div>
      )}

      {!isLoading && !error && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-card-border p-10 text-center">
          <p className="text-sm text-text-secondary">
            {data && data.length > 0
              ? "No schedules match this filter."
              : "No schedules yet. Create one to run a target on a cadence."}
          </p>
          {(!data || data.length === 0) && (
            <Button asChild className="mt-4">
              <Link href="/schedules/new">
                <Plus /> New schedule
              </Link>
            </Button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              isRunning={runningId === schedule.id}
              onRunNow={() => {
                setRunningId(schedule.id);
                runNow.mutate(schedule.id, {
                  onSettled: () => setRunningId(null),
                });
              }}
              onDelete={() => setPendingDelete(schedule)}
            />
          ))}
        </div>
      )}

      <DeleteConfirmationModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        isDeleting={remove.isPending}
        title="Delete schedule"
        description={
          pendingDelete
            ? `Delete "${pendingDelete.name}" and its run history? This cannot be undone.`
            : ""
        }
        onConfirm={() => {
          if (pendingDelete) {
            remove.mutate(pendingDelete.id, {
              onSettled: () => setPendingDelete(null),
            });
          }
        }}
      />
    </ContentLayout>
  );
}
