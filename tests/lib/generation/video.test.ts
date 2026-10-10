import { describe, expect, it } from "vitest";

import {
  parseVideoJob,
  parseVideoSubmission,
  videoJobOutcome,
  type VideoJob,
} from "@/lib/generation/video";

/** Factories rather than inline literals, so a new field reaches every case. */
function job(overrides: Partial<VideoJob> = {}): VideoJob {
  return { id: "gen-vid-1", status: "pending", ...overrides };
}

function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-vid-1",
    polling_url: "https://openrouter.ai/api/v1/videos/gen-vid-1",
    status: "in_progress",
    ...overrides,
  };
}

describe("parseVideoSubmission", () => {
  it("reads the job id to follow", () => {
    expect(
      parseVideoSubmission({ id: "gen-vid-1", status: "pending" }),
    ).toEqual({ id: "gen-vid-1" });
  });

  it("rejects anything with no job to poll", () => {
    expect(parseVideoSubmission(undefined)).toBeNull();
    expect(parseVideoSubmission(null)).toBeNull();
    expect(parseVideoSubmission("gen-vid-1")).toBeNull();
    expect(parseVideoSubmission({ status: "pending" })).toBeNull();
    expect(parseVideoSubmission({ id: "" })).toBeNull();
    expect(parseVideoSubmission({ id: 42 })).toBeNull();
  });
});

describe("parseVideoJob", () => {
  it("reads the status and the content URL", () => {
    const parsed = parseVideoJob(
      statusBody({
        status: "completed",
        unsigned_urls: ["https://openrouter.ai/api/v1/videos/gen-vid-1/content?index=0"],
      }),
    );

    expect(parsed?.status).toBe("completed");
    expect(parsed?.contentUrl).toBe(
      "https://openrouter.ai/api/v1/videos/gen-vid-1/content?index=0",
    );
  });

  it("reads the reported cost", () => {
    const parsed = parseVideoJob(
      statusBody({ status: "completed", usage: { cost: 0.25, is_byok: false } }),
    );

    expect(parsed?.costUsd).toBe(0.25);
  });

  it("omits the cost when the response does not report one", () => {
    expect(parseVideoJob(statusBody())?.costUsd).toBeUndefined();
    expect(parseVideoJob(statusBody({ usage: { is_byok: true } }))?.costUsd).toBeUndefined();
  });

  it("normalises the status's case", () => {
    expect(parseVideoJob(statusBody({ status: "IN_PROGRESS" }))?.status).toBe(
      "in_progress",
    );
  });

  it("reports an unrecognised status as unknown rather than inventing one", () => {
    // A status a future API adds: kept distinct from `pending` so the outcome
    // decides what to do with it, and nothing silently waits forever.
    expect(parseVideoJob(statusBody({ status: "queued" }))?.status).toBe("unknown");
    expect(parseVideoJob(statusBody({ status: "" }))?.status).toBe("unknown");
    expect(parseVideoJob({ id: "gen-vid-1" })?.status).toBe("unknown");
  });

  it("takes the first usable URL and ignores the rest", () => {
    const parsed = parseVideoJob(
      statusBody({ unsigned_urls: ["", "https://example.com/a.mp4", "https://example.com/b.mp4"] }),
    );

    expect(parsed?.contentUrl).toBe("https://example.com/a.mp4");
  });

  it("has no content URL when the list holds none", () => {
    expect(parseVideoJob(statusBody({ unsigned_urls: [] }))?.contentUrl).toBeUndefined();
    expect(parseVideoJob(statusBody({ unsigned_urls: [1, null] }))?.contentUrl).toBeUndefined();
    expect(parseVideoJob(statusBody({ unsigned_urls: "https://example.com/a.mp4" }))?.contentUrl).toBeUndefined();
  });

  it("carries the provider's error message", () => {
    expect(
      parseVideoJob(statusBody({ status: "failed", error: "content policy" }))?.error,
    ).toBe("content policy");
  });

  it("rejects anything that is not a status object", () => {
    expect(parseVideoJob(undefined)).toBeNull();
    expect(parseVideoJob(null)).toBeNull();
    expect(parseVideoJob("in_progress")).toBeNull();
    expect(parseVideoJob(["in_progress"])).toBeNull();
  });
});

describe("videoJobOutcome", () => {
  it("keeps waiting while the job is still working", () => {
    expect(videoJobOutcome(job({ status: "pending" }))).toEqual({ kind: "waiting" });
    expect(videoJobOutcome(job({ status: "in_progress" }))).toEqual({ kind: "waiting" });
  });

  it("keeps waiting on a status it does not recognise", () => {
    // The safe direction: the wait budget bounds the loop, whereas failing here
    // would abandon a job that may be progressing fine.
    expect(videoJobOutcome(job({ status: "unknown" }))).toEqual({ kind: "waiting" });
  });

  it("is ready once the job is completed with somewhere to fetch from", () => {
    expect(
      videoJobOutcome(
        job({ status: "completed", contentUrl: "https://example.com/a.mp4", costUsd: 0.5 }),
      ),
    ).toEqual({
      kind: "ready",
      contentUrl: "https://example.com/a.mp4",
      costUsd: 0.5,
    });
  });

  it("fails a completed job that offers nothing to fetch", () => {
    const outcome = videoJobOutcome(job({ status: "completed" }));

    expect(outcome.kind).toBe("failed");
  });

  it("reports the provider's own message on a failure", () => {
    expect(
      videoJobOutcome(job({ status: "failed", error: "prompt rejected" })),
    ).toEqual({ kind: "failed", reason: "prompt rejected" });
  });

  it("still fails a failed job that carries no message", () => {
    const outcome = videoJobOutcome(job({ status: "failed" }));

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason.length > 0).toBe(true);
  });

  it("fails a cancelled or expired job", () => {
    expect(videoJobOutcome(job({ status: "cancelled" })).kind).toBe("failed");
    expect(videoJobOutcome(job({ status: "expired" })).kind).toBe("failed");
  });
});
