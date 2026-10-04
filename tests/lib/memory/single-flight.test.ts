import { describe, expect, it } from "vitest";
import { createSingleFlight } from "@/lib/memory/single-flight";

/** A promise plus its settle handles, so a test can hold a task open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlight", () => {
  it("lets concurrent callers for one key share a single task", async () => {
    const flight = createSingleFlight<number>();
    let calls = 0;
    const gate = deferred<number>();
    const task = () => {
      calls += 1;
      return gate.promise;
    };

    const first = flight.run("user-1", task);
    const second = flight.run("user-1", task);

    expect(calls).toBe(1);
    expect(second).toBe(first);

    gate.resolve(7);
    await expect(first).resolves.toBe(7);
    await expect(second).resolves.toBe(7);
  });

  it("runs a fresh task once the previous one has settled", async () => {
    // The entry must not be cached: a nudge now and a cron pass a minute later
    // are two passes, and the second must actually run.
    const flight = createSingleFlight<number>();
    let calls = 0;
    const task = async () => {
      calls += 1;
      return calls;
    };

    await flight.run("user-1", task);
    await flight.run("user-1", task);

    expect(calls).toBe(2);
  });

  it("keeps different keys independent", async () => {
    const flight = createSingleFlight<string>();
    const calls: string[] = [];
    const task = (key: string) => async () => {
      calls.push(key);
      return key;
    };

    await Promise.all([flight.run("a", task("a")), flight.run("b", task("b"))]);

    expect(calls.sort()).toEqual(["a", "b"]);
  });

  it("does not cache a failure, so the next call retries", async () => {
    // A sweep that threw must not poison the key: the capture is still on disk.
    const flight = createSingleFlight<number>();
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("boom");
    };

    await expect(flight.run("user-1", failing)).rejects.toThrow("boom");
    await expect(flight.run("user-1", failing)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});
