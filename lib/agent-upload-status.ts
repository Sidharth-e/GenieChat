export type UploadFileStatus = "pending" | "processing" | "completed" | "failed";

export interface BackgroundUploadFile {
  id: string;
  name: string;
  size: number;
  status: UploadFileStatus;
  error?: string;
}

export interface BackgroundUploadJob {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finishedAt?: string;
  files: BackgroundUploadFile[];
}

const STORAGE_KEY = "agent-background-upload-jobs";
const UPDATE_EVENT_NAME = "agent-upload-jobs-updated";
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;
const DONE_JOB_TTL_MS = 2 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function emitUpdate() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT_NAME));
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeFileId(file: { name: string; size: number }, index: number): string {
  return `${file.name}-${file.size}-${index}`;
}

function cleanupJobs(jobs: BackgroundUploadJob[], nowMs: number): BackgroundUploadJob[] {
  return jobs.filter((job) => {
    const startedMs = new Date(job.startedAt).getTime();
    if (Number.isNaN(startedMs) || nowMs - startedMs > MAX_JOB_AGE_MS) {
      return false;
    }

    const hasInProgressFile = job.files.some(
      (file) => file.status === "pending" || file.status === "processing",
    );
    if (hasInProgressFile) return true;

    if (!job.finishedAt) return true;
    const finishedMs = new Date(job.finishedAt).getTime();
    if (Number.isNaN(finishedMs)) return false;
    return nowMs - finishedMs <= DONE_JOB_TTL_MS;
  });
}

export function getUploadJobsUpdatedEventName(): string {
  return UPDATE_EVENT_NAME;
}

export function readBackgroundUploadJobs(): BackgroundUploadJob[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as BackgroundUploadJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBackgroundUploadJobs(jobs: BackgroundUploadJob[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  emitUpdate();
}

function updateJobs(
  updater: (jobs: BackgroundUploadJob[]) => BackgroundUploadJob[],
): BackgroundUploadJob[] {
  const existing = readBackgroundUploadJobs();
  const next = cleanupJobs(updater(existing), Date.now());
  writeBackgroundUploadJobs(next);
  return next;
}

export function createBackgroundUploadJob(input: {
  agentId: string;
  agentName: string;
  files: File[];
}): string {
  const jobId = `${input.agentId}-${Date.now()}`;
  const files: BackgroundUploadFile[] = input.files.map((file, index) => ({
    id: makeFileId(file, index),
    name: file.name,
    size: file.size,
    status: "pending",
  }));

  updateJobs((jobs) => [
    ...jobs,
    {
      id: jobId,
      agentId: input.agentId,
      agentName: input.agentName,
      startedAt: nowIso(),
      files,
    },
  ]);

  return jobId;
}

export function markBackgroundUploadFileStatus(input: {
  jobId: string;
  file: File;
  fileIndex: number;
  status: UploadFileStatus;
  error?: string;
}) {
  const targetFileId = makeFileId(input.file, input.fileIndex);

  updateJobs((jobs) =>
    jobs.map((job) => {
      if (job.id !== input.jobId) return job;

      const files = job.files.map((file) =>
        file.id === targetFileId
          ? {
              ...file,
              status: input.status,
              error: input.error,
            }
          : file,
      );

      const isDone = files.every(
        (file) => file.status === "completed" || file.status === "failed",
      );

      return {
        ...job,
        files,
        finishedAt: isDone ? nowIso() : undefined,
      };
    }),
  );
}

export function dismissBackgroundUploadJob(jobId: string) {
  updateJobs((jobs) => jobs.filter((job) => job.id !== jobId));
}

export function pruneBackgroundUploadJobs() {
  updateJobs((jobs) => jobs);
}

