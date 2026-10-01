import { describe, it, expect } from "vitest";
import {
  createChatTracker,
  createAgentTracker,
  createMultiAgentTracker,
} from "@/lib/api/stream/tool-calls";

describe("createChatTracker", () => {
  // chatService.streamChat already emits UI-stable ids, so start and result
  // match by id directly.
  it("matches a result to its start by id", () => {
    const tracker = createChatTracker();
    const start = tracker.onStart({ sourceId: "call-1", name: "search", args: {} });

    expect(start.id).toBe("call-1");
    expect(tracker.onResult({ sourceId: "call-1" }).id).toBe("call-1");
  });

  it("returns no id when the result carries none", () => {
    const tracker = createChatTracker();
    tracker.onStart({ sourceId: "call-1", name: "search", args: {} });

    expect(tracker.onResult({}).id).toBeUndefined();
  });
});

describe("createAgentTracker", () => {
  // agentService emits source ids that are not UI ids, so a start mints a UI id
  // and the result is resolved back through the map.
  it("mints a UI id and resolves the result back to it", () => {
    const tracker = createAgentTracker();
    const start = tracker.onStart({ sourceId: "src-1", name: "search", args: {} });

    expect(start.id).not.toBe("src-1");
    expect(tracker.onResult({ sourceId: "src-1" }).id).toBe(start.id);
  });

  it("reuses the minted id when the same source id starts twice", () => {
    const tracker = createAgentTracker();
    const first = tracker.onStart({ sourceId: "src-1", name: "search", args: {} });
    const second = tracker.onStart({ sourceId: "src-1", name: "search", args: {} });

    expect(second.id).toBe(first.id);
  });

  it("falls back to the oldest pending call when the result has no known id", () => {
    const tracker = createAgentTracker();
    const first = tracker.onStart({ sourceId: "src-1", name: "a", args: {} });
    tracker.onStart({ sourceId: "src-2", name: "b", args: {} });

    expect(tracker.onResult({}).id).toBe(first.id);
  });

  it("does not hand the same pending call out twice", () => {
    const tracker = createAgentTracker();
    const first = tracker.onStart({ sourceId: "src-1", name: "a", args: {} });
    const second = tracker.onStart({ sourceId: "src-2", name: "b", args: {} });

    expect(tracker.onResult({}).id).toBe(first.id);
    expect(tracker.onResult({}).id).toBe(second.id);
  });

  // agent/stream.ts mints a fresh id and pushes a synthetic record rather than
  // dropping an unmatched result — the client must never see a tool_result for
  // an id it was never told about.
  it("mints a synthetic call when nothing is pending and the result is unknown", () => {
    const tracker = createAgentTracker();
    const result = tracker.onResult({ name: "search" });

    expect(result.id).toBeDefined();
    expect(result.record).toEqual({
      id: result.id,
      name: "search",
      arguments: {},
    });
  });

  it("names the synthetic call unknown_tool when the result carries no name", () => {
    const tracker = createAgentTracker();

    expect(tracker.onResult({}).record?.name).toBe("unknown_tool");
  });
});

describe("createMultiAgentTracker", () => {
  it("matches a result to its start by event id", () => {
    const tracker = createMultiAgentTracker();
    const start = tracker.onStart({
      sourceId: "ev-1",
      name: "search",
      args: {},
      meta: { agentId: "a1", agentName: "Researcher" },
    });

    expect(tracker.onResult({ sourceId: "ev-1" }).id).toBe(start.id);
  });

  it("stamps the agent identity onto the persisted record", () => {
    const tracker = createMultiAgentTracker();
    const start = tracker.onStart({
      sourceId: "ev-1",
      name: "search",
      args: {},
      meta: { agentId: "a1", agentName: "Researcher" },
    });

    expect(start.record.agentId).toBe("a1");
    expect(start.record.agentName).toBe("Researcher");
  });

  // The reason this tracker is not the agent tracker: a supervisor and a
  // sub-agent can both call a tool of the same name.
  it("does not let one agent's result steal another's same-named call", () => {
    const tracker = createMultiAgentTracker();
    const supervisor = tracker.onStart({
      name: "search",
      args: {},
      meta: { agentId: undefined, agentName: undefined },
    });
    const subAgent = tracker.onStart({
      name: "search",
      args: {},
      meta: { agentId: "a1", agentName: "Researcher" },
    });

    expect(supervisor.id).not.toBe(subAgent.id);

    const resolvedSub = tracker.onResult({
      name: "search",
      meta: { agentId: "a1", agentName: "Researcher" },
    });
    expect(resolvedSub.id).toBe(subAgent.id);

    const resolvedSupervisor = tracker.onResult({ name: "search" });
    expect(resolvedSupervisor.id).toBe(supervisor.id);
  });

  it("falls back to a legacy name:agent key when no event id is known", () => {
    const tracker = createMultiAgentTracker();
    const start = tracker.onStart({
      name: "search",
      args: {},
      meta: { agentId: "a1", agentName: "Researcher" },
    });

    expect(tracker.onResult({ name: "search", meta: { agentId: "a1" } }).id).toBe(start.id);
  });

  it("returns no id when neither the event id nor the legacy key is known", () => {
    const tracker = createMultiAgentTracker();
    tracker.onStart({ name: "search", args: {}, meta: { agentId: "a1" } });

    expect(tracker.onResult({ name: "other", meta: { agentId: "a2" } }).id).toBeUndefined();
  });

  // multi-agent/stream.ts resolves through `byEventId.get(id) || id`, so an
  // unknown event id is echoed back rather than dropped. The client still sees
  // the result frame it would have seen before.
  it("echoes an unknown event id rather than dropping the result", () => {
    const tracker = createMultiAgentTracker();

    expect(tracker.onResult({ sourceId: "ev-9", name: "search" }).id).toBe("ev-9");
  });
});
