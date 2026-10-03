import { describe, it, expect } from "vitest";
import { filterMcpServers, toSnakeCase } from "@/lib/api/stream/tooling";
import type { MCPServerConfig } from "@/lib/types";

function server(overrides: Partial<MCPServerConfig> & { name: string }): MCPServerConfig {
  return {
    id: `srv-${overrides.name}`,
    userId: "u1",
    userName: "User",
    userEmail: "u@example.com",
    transportType: "http",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toSnakeCase", () => {
  it("lowercases and joins words with underscores", () => {
    expect(toSnakeCase("My Tool Name")).toBe("my_tool_name");
  });

  it("trims surrounding whitespace", () => {
    expect(toSnakeCase("  Foo Bar  ")).toBe("foo_bar");
  });

  it("collapses runs of punctuation into a single underscore", () => {
    expect(toSnakeCase("a!!b")).toBe("a_b");
  });

  it("strips leading and trailing separators", () => {
    expect(toSnakeCase("__lead")).toBe("lead");
    expect(toSnakeCase("trail--")).toBe("trail");
  });

  it("keeps digits", () => {
    expect(toSnakeCase("Tool 2")).toBe("tool_2");
  });
});

describe("filterMcpServers", () => {
  it("returns no servers when no tools are required", () => {
    const allServers = [server({ name: "github" })];

    expect(filterMcpServers({ allServers, secretMap: {} })).toEqual([]);
    expect(
      filterMcpServers({ allServers, secretMap: {}, allowedTools: [] }),
    ).toEqual([]);
  });

  it("keeps only the enabled servers a prefixed tool names", () => {
    const allServers = [
      server({ name: "github" }),
      server({ name: "slack" }),
      server({ name: "jira", enabled: false }),
    ];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      allowedTools: ["github:create_issue", "jira:create_ticket"],
    });

    expect(kept.map((s) => s.name)).toEqual(["github"]);
  });

  it("keeps every enabled server when no tool carries a server prefix", () => {
    const allServers = [
      server({ name: "github" }),
      server({ name: "slack" }),
      server({ name: "jira", enabled: false }),
    ];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      allowedTools: ["plain_tool"],
    });

    expect(kept.map((s) => s.name)).toEqual(["github", "slack"]);
  });

  it("unions allowedTools with extraRequiredTools", () => {
    const allServers = [server({ name: "github" }), server({ name: "slack" })];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      allowedTools: ["github:create_issue"],
      extraRequiredTools: ["slack:post"],
    });

    expect(kept.map((s) => s.name)).toEqual(["github", "slack"]);
  });

  it("accepts extraRequiredTools with no allowedTools at all", () => {
    const allServers = [server({ name: "github" }), server({ name: "slack" })];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      extraRequiredTools: ["slack:post"],
    });

    expect(kept.map((s) => s.name)).toEqual(["slack"]);
  });

  it("lets a prefixed tool narrow the result even when an unprefixed one is also required", () => {
    const allServers = [server({ name: "github" }), server({ name: "slack" })];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      allowedTools: ["github:create_issue"],
      extraRequiredTools: ["plain_tool"],
    });

    expect(kept.map((s) => s.name)).toEqual(["github"]);
  });

  it("keeps every enabled server when includeAllEnabled is set, with nothing required", () => {
    const allServers = [
      server({ name: "github" }),
      server({ name: "slack" }),
      server({ name: "jira", enabled: false }),
    ];

    const kept = filterMcpServers({
      allServers,
      secretMap: {},
      includeAllEnabled: true,
    });

    expect(kept.map((s) => s.name)).toEqual(["github", "slack"]);
  });

  it("still drops disabled servers when includeAllEnabled is set", () => {
    const allServers = [
      server({ name: "github", enabled: false }),
      server({ name: "slack", enabled: false }),
    ];

    expect(
      filterMcpServers({ allServers, secretMap: {}, includeAllEnabled: true }),
    ).toEqual([]);
  });

  it("resolves secrets when includeAllEnabled is set", () => {
    const allServers = [
      server({
        name: "github",
        headers: { Authorization: "env.GITHUB_TOKEN" },
      }),
    ];

    const kept = filterMcpServers({
      allServers,
      secretMap: { GITHUB_TOKEN: "ghp_secret" },
      includeAllEnabled: true,
    });

    expect(kept[0].headers).toEqual({ Authorization: "ghp_secret" });
  });
});
