import { describe, it, expect, vi } from "vitest";
import { createTokenBuffer, createSseWriter, SSE_HEADERS } from "@/lib/api/stream/envelope";

describe("createTokenBuffer", () => {
  it("emits nothing before the flush interval elapses", () => {
    const onFlush = vi.fn();
    let now = 1000;
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => now });

    buffer.push("a");
    buffer.push("b");
    now = 1005;

    expect(onFlush).not.toHaveBeenCalled();
    expect(buffer.hasPending()).toBe(true);
  });

  it("accumulates into a single flush once the interval elapses", () => {
    const onFlush = vi.fn();
    let now = 1000;
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => now });

    buffer.push("a");
    buffer.push("b");
    now = 1010;
    buffer.push("c");

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("abc", undefined);
  });

  it("flushes the pending buffer when the metadata key changes", () => {
    const onFlush = vi.fn();
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => 1000 });

    buffer.push("supervisor", { agentId: "s1" });
    buffer.push("agent text", { agentId: "a1" });

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenLastCalledWith("supervisor", { agentId: "s1" });
    expect(buffer.hasPending()).toBe(true);
  });

  it("does not flush on a meta change when nothing is pending", () => {
    const onFlush = vi.fn();
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => 1000 });

    buffer.push("only", { agentId: "a1" });

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flushes pending content with its metadata on demand", () => {
    const onFlush = vi.fn();
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => 1000 });

    buffer.push("x", { agentId: "a1" });
    buffer.flush();

    expect(onFlush).toHaveBeenCalledWith("x", { agentId: "a1" });
    expect(buffer.hasPending()).toBe(false);
  });

  it("is a no-op when flushing with nothing pending", () => {
    const onFlush = vi.fn();
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => 1000 });

    buffer.flush();
    buffer.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("resets the interval clock after a flush", () => {
    const onFlush = vi.fn();
    let now = 1000;
    const buffer = createTokenBuffer({ onFlush, flushIntervalMs: 10, now: () => now });

    buffer.push("a");
    now = 1010;
    buffer.push("b"); // flushes "a"
    expect(onFlush).toHaveBeenCalledTimes(1);

    buffer.push("c");
    now = 1015;
    buffer.push("d"); // only 5ms since the flush
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});

describe("createSseWriter", () => {
  it("writes a data frame followed by a blank line", () => {
    const enqueue = vi.fn();
    const controller = { enqueue } as unknown as ReadableStreamDefaultController;
    const write = createSseWriter(controller, new TextEncoder());

    write({ type: "token", content: "hi" });

    expect(enqueue).toHaveBeenCalledTimes(1);
    const frame = new TextDecoder().decode(enqueue.mock.calls[0][0]);
    expect(frame).toBe('data: {"type":"token","content":"hi"}\n\n');
  });
});

describe("SSE_HEADERS", () => {
  it("declares an event stream", () => {
    expect(SSE_HEADERS["Content-Type"]).toBe("text/event-stream");
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache");
  });
});
