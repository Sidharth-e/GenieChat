import { describe, it, expect } from "vitest";
import {
  getThreadRoute,
  getCanvasRoute,
  isNavItemActive,
  HOME_ROUTE,
  RAIL_ITEMS,
  RAIL_HISTORY_ITEM,
  BUILD_ITEMS,
} from "@/constants/nav-routes";

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
  it("falls back to the home route when no threads", () => {
    expect(getCanvasRoute([])).toBe(HOME_ROUTE);
    expect(getCanvasRoute(undefined)).toBe(HOME_ROUTE);
  });
  it("uses the most recent thread", () => {
    expect(getCanvasRoute([{ id: "t9" }])).toBe("/chat/t9");
  });
});

describe("isNavItemActive", () => {
  it("matches the exact route", () => {
    expect(isNavItemActive("/agents", "/agents")).toBe(true);
  });
  it("matches nested routes", () => {
    expect(isNavItemActive("/agents/a1/edit", "/agents")).toBe(true);
  });
  it("does not match a sibling that merely shares the prefix", () => {
    expect(isNavItemActive("/agents-old", "/agents")).toBe(false);
  });
});

describe("HOME_ROUTE", () => {
  it("points at the new-chat canvas", () => {
    expect(HOME_ROUTE).toBe("/chat/new");
  });
  it("is the Home rail entry", () => {
    expect(RAIL_ITEMS[0].href).toBe(HOME_ROUTE);
  });
});

describe("rail config", () => {
  it("lists the core destinations", () => {
    expect(RAIL_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Schedules",
      "Agents",
      "Workflows",
      "Artifacts",
    ]);
    expect(RAIL_HISTORY_ITEM.label).toBe("History");
  });
  it("gives every destination a distinct route", () => {
    const hrefs = [...RAIL_ITEMS, RAIL_HISTORY_ITEM, ...BUILD_ITEMS].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("holds the remaining secondary routes in the build flyout", () => {
    expect(BUILD_ITEMS.map((i) => i.href)).toEqual(["/auto", "/tools", "/webhooks"]);
  });
});
