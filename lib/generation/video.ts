/**
 * Pure parsing for the OpenRouter video API.
 *
 * Video is an asynchronous job rather than a call — `POST /api/v1/videos`
 * answers `202` with a job id, and the bytes are only reachable once a poll
 * reports `completed` and offers a content URL. So the decisions worth naming
 * here are which submissions are worth following, what a status means, and when
 * a job is finished with — none of which needs a network to state.
 */

export type VideoJobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

const VIDEO_JOB_STATUSES: readonly string[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "expired",
];

export interface VideoSubmission {
  id: string;
}

export interface VideoJob {
  /** The provider's job id, or an empty string where the poll omitted it. */
  id: string;
  /**
   * `unknown` is a status this build does not recognise — a value a future API
   * added, say. It is carried rather than folded into `pending` so the outcome
   * can decide what to do with it in one place.
   */
  status: VideoJobStatus | "unknown";
  /** Where the bytes are. Present once the job is `completed`. */
  contentUrl?: string;
  /** Provider-reported cost in USD, when the response carried one. */
  costUsd?: number;
  /** The provider's own message, present on a failure. */
  error?: string;
}

export type VideoJobOutcome =
  | { kind: "waiting" }
  | { kind: "ready"; contentUrl: string; costUsd?: number }
  | { kind: "failed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  // Arrays are excluded deliberately: `typeof []` is `"object"`, and a JSON
  // array is not a status object — reading one would silently yield a job with
  // no status rather than reporting a response we cannot interpret.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a `POST /api/v1/videos` response body for the job id to follow.
 *
 * Returns `null` when there is no job to poll, which is the caller's cue to
 * report a failure rather than loop on an id it does not have.
 */
export function parseVideoSubmission(payload: unknown): VideoSubmission | null {
  if (!isRecord(payload)) return null;
  const id = payload.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return { id };
}

/**
 * Parses a `GET /api/v1/videos/{id}` response body.
 *
 * Returns `null` only for something that is not a status object at all. A
 * response with an absent or unrecognised `status` is still returned, carrying
 * `unknown`, because the shape of the answer is not in doubt — only its
 * interpretation is, and that belongs to {@link videoJobOutcome}.
 */
export function parseVideoJob(payload: unknown): VideoJob | null {
  if (!isRecord(payload)) return null;

  const rawStatus =
    typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  const status = VIDEO_JOB_STATUSES.includes(rawStatus) ? rawStatus : "unknown";

  const urls = Array.isArray(payload.unsigned_urls) ? payload.unsigned_urls : [];
  const contentUrl = urls.find(
    (url): url is string => typeof url === "string" && url.length > 0,
  );

  const usage = payload.usage;

  return {
    id: typeof payload.id === "string" ? payload.id : "",
    status: status as VideoJob["status"],
    contentUrl,
    costUsd:
      isRecord(usage) && typeof usage.cost === "number" ? usage.cost : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}

/**
 * What a poll means: keep waiting, the video is ready, or the job is over.
 *
 * Only `completed` is allowed to yield `ready` — a job that claims completion
 * but offers nothing to fetch is a failure, for the same reason
 * `parseImageResponse` rejects a response with no image: "succeeded with
 * nothing" would render as a reply that silently lacks what it promised.
 *
 * `pending`, `in_progress` and an unrecognised status all keep the poll going.
 * Waiting on a status we do not know is the safe direction: the alternative
 * abandons a job that may be progressing fine, and the caller's wait budget is
 * what bounds the loop either way.
 */
export function videoJobOutcome(job: VideoJob): VideoJobOutcome {
  switch (job.status) {
    case "completed":
      return job.contentUrl
        ? { kind: "ready", contentUrl: job.contentUrl, costUsd: job.costUsd }
        : {
            kind: "failed",
            reason:
              "OpenRouter reported the video as completed but returned no content URL.",
          };
    case "failed":
      return {
        kind: "failed",
        reason:
          job.error || "The provider failed to generate the video.",
      };
    case "cancelled":
      return { kind: "failed", reason: "The video job was cancelled." };
    case "expired":
      return {
        kind: "failed",
        reason: "The video job expired before it finished generating.",
      };
    default:
      return { kind: "waiting" };
  }
}
