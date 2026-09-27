import { describe, it, expect } from "vitest";
import { getThreadRoute, getCanvasRoute, RAIL_ITEMS, BUILD_ITEMS, LIBRARY_ITEMS } from "@/constants/routes";

describe("getThreadRoute", () => {
  it("routes swarm threads", () => {
    expect(getThreadRoute({ id: "t1", isSwarm: true })).toBe("/swarm-chat/t1");
  });
  it("routes multi-agent threads", () => {
    expect(getThreadRoute({ id: "t1", agentId: "a1", isMultiAgent: true })).toBe("/multi-agent-chat/a1/t1");
  });
  it("routes plain threads", () => {
    expect(getThreadRoute({ id: "t1" })).toBe("/chat/t1");
  });
});

describe("getCanvasRoute", () => {
  it("falls back to /chat/new when no threads", () => {
    expect(getCanvasRoute([])).toBe("/chat/new");
    expect(getCanvasRoute(undefined)).toBe("/chat/new");
  });
  it("uses the most recent thread", () => {
    expect(getCanvasRoute([{ id: "t9" }])).toBe("/chat/t9");
  });
});

describe("rail config", () => {
  it("has the five core destinations", () => {
    expect(RAIL_ITEMS.map((i) => i.label)).toEqual(["Home", "Agents", "MCP", "Workflows", "History"]);
  });
  it("flyout groups hold the secondary routes", () => {
    expect(BUILD_ITEMS.map((i) => i.href)).toEqual(["/auto", "/prompts", "/tools", "/webhooks"]);
    expect(LIBRARY_ITEMS.map((i) => i.href)).toEqual(["/artifacts", "/memories"]);
  });
});
