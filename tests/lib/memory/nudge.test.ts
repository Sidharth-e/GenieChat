import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above the imports, so the spies are hoisted with it.
const { after, sweepUser, logger } = vi.hoisted(() => ({
  after: vi.fn<(cb: () => void) => void>(),
  sweepUser: vi.fn(async () => ({
    captures: 0,
    reconciled: 0,
    merged: 0,
    embedded: 0,
  })),
  logger: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/memory/sweep-runner", () => ({ sweepUser }));
vi.mock("@/lib/logger", () => ({ logger }));

const { nudgeMemorySweep } = await import("@/lib/memory/nudge");

describe("nudgeMemorySweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules one sweep for that user after the response", () => {
    nudgeMemorySweep("u1");
    expect(after).toHaveBeenCalledTimes(1);

    after.mock.calls[0][0]();
    expect(sweepUser).toHaveBeenCalledWith("u1");
  });

  it("falls back to a detached sweep when there is no request scope", () => {
    after.mockImplementationOnce(() => {
      throw new Error("no request scope");
    });

    expect(() => nudgeMemorySweep("u1")).not.toThrow();
    expect(sweepUser).toHaveBeenCalledWith("u1");
  });

  it("reports a failed sweep rather than surfacing it", async () => {
    // Awaiting the report is what makes this prove the contract: without the
    // rejection handler the sweep rejects and the log never happens, so the
    // assertion fails rather than passing over an unobserved promise.
    sweepUser.mockRejectedValueOnce(new Error("neo4j down"));

    nudgeMemorySweep("u1");
    expect(() => after.mock.calls[0][0]()).not.toThrow();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
  });

  it("survives a sweep that cannot even start", () => {
    // A throw from the sweep call itself, before any promise exists, must not
    // reach the request: the capture it follows is already durable, so a nudge
    // that cannot start has to cost the response nothing.
    sweepUser.mockImplementationOnce(() => {
      throw new Error("driver missing");
    });

    nudgeMemorySweep("u1");
    expect(() => after.mock.calls[0][0]()).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
