import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above the imports, so the spies are hoisted with it.
const { after, sweepUser } = vi.hoisted(() => ({
  after: vi.fn<(cb: () => void) => void>(),
  sweepUser: vi.fn(async () => ({
    captures: 0,
    reconciled: 0,
    merged: 0,
    embedded: 0,
  })),
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/memory/sweep-runner", () => ({ sweepUser }));

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

  it("does not surface a failed sweep to its caller", () => {
    sweepUser.mockRejectedValueOnce(new Error("neo4j down"));

    nudgeMemorySweep("u1");
    expect(() => after.mock.calls[0][0]()).not.toThrow();
  });
});
