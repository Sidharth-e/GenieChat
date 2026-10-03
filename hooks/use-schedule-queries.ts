"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isRunOpen } from "@/lib/schedules/retry";
import type { Schedule, ScheduleRun } from "@/lib/types";

export type ScheduleListItem = Schedule & { targetName?: string };

export interface ScheduleFilters {
  enabled?: boolean;
  targetType?: string;
  targetId?: string;
}

export interface ScheduleRunPage {
  runs: ScheduleRun[];
  total: number;
}

export const scheduleKeys = {
  all: ["schedules"] as const,
  lists: () => [...scheduleKeys.all, "list"] as const,
  list: (filters: ScheduleFilters) => [...scheduleKeys.lists(), filters] as const,
  detail: (id: string) => [...scheduleKeys.all, "detail", id] as const,
  runs: (scheduleId: string) => [...scheduleKeys.detail(scheduleId), "runs"] as const,
  run: (scheduleId: string, runId: string) =>
    [...scheduleKeys.runs(scheduleId), runId] as const,
};

/** Unwraps the API's error envelope so a caller shows the server's sentence, not a status code. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error ?? body?.message ?? `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

function queryString(filters: ScheduleFilters): string {
  const params = new URLSearchParams();
  if (filters.enabled !== undefined) params.set("enabled", String(filters.enabled));
  if (filters.targetType) params.set("target.type", filters.targetType);
  if (filters.targetId) params.set("target.id", filters.targetId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSchedules(filters: ScheduleFilters = {}) {
  return useQuery<ScheduleListItem[]>({
    queryKey: scheduleKeys.list(filters),
    queryFn: async () =>
      readJson<ScheduleListItem[]>(
        await fetch(`/api/schedules${queryString(filters)}`),
      ),
  });
}

export function useSchedule(id: string | null) {
  return useQuery<ScheduleListItem>({
    queryKey: scheduleKeys.detail(id ?? ""),
    queryFn: async () =>
      readJson<ScheduleListItem>(await fetch(`/api/schedules/${id}`)),
    enabled: !!id,
  });
}

function useInvalidateSchedules() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
  };
}

export function useCreateSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation<Schedule, Error, Record<string, unknown>>({
    mutationFn: async (body) =>
      readJson<Schedule>(
        await fetch("/api/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateSchedule(id: string) {
  const invalidate = useInvalidateSchedules();
  return useMutation<Schedule, Error, Record<string, unknown>>({
    mutationFn: async (body) =>
      readJson<Schedule>(
        await fetch(`/api/schedules/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await readJson(await fetch(`/api/schedules/${id}`, { method: "DELETE" }));
    },
    onSuccess: invalidate,
  });
}

/**
 * "Run now".
 *
 * Takes the schedule id as the mutation *variable* rather than as a hook argument,
 * because the list surface runs one schedule out of many: a hook bound to an id at
 * creation time could only serve a card that owned its own mutation, and the list
 * would have to hold one per row.
 *
 * Invalidates the run list and the schedule list, because the point of pressing it
 * is to watch a run appear and the row's status change -- and it resolves with the
 * new run's id so a caller can poll exactly that run rather than the whole history.
 */
export function useRunSchedule() {
  const queryClient = useQueryClient();
  return useMutation<{ runId: string }, Error, string>({
    mutationFn: async (scheduleId) =>
      readJson<{ runId: string }>(
        await fetch(`/api/schedules/${scheduleId}/run`, { method: "POST" }),
      ),
    onSuccess: (_data, scheduleId) => {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.runs(scheduleId) });
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.lists() });
    },
  });
}

export function useScheduleRuns(
  scheduleId: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
) {
  return useQuery<ScheduleRunPage>({
    queryKey: [...scheduleKeys.runs(scheduleId), { limit, offset }],
    queryFn: async () =>
      readJson<ScheduleRunPage>(
        await fetch(`/api/schedules/${scheduleId}/runs?limit=${limit}&offset=${offset}`),
      ),
    enabled: !!scheduleId,
  });
}

/**
 * One run, polled while it is still open.
 *
 * `isRunOpen` is the same predicate the server's own state machine uses, so the
 * poller cannot be left waiting on a status the server considers settled -- and
 * it stops on `skipped` and `cancelled` too, which a check written inline as
 * "not succeeded and not failed" would miss.
 */
export function useScheduleRun(scheduleId: string | null, runId: string | null) {
  return useQuery<ScheduleRun>({
    queryKey: scheduleKeys.run(scheduleId ?? "", runId ?? ""),
    queryFn: async () =>
      readJson<ScheduleRun>(
        await fetch(`/api/schedules/${scheduleId}/runs/${runId}`),
      ),
    enabled: !!scheduleId && !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isRunOpen(status) ? 2000 : false;
    },
  });
}
