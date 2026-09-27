import { describe, expect, it } from "vitest";
import { resolveRoleFromUsername, type RoleAllowlists } from "@/lib/auth/role-resolution";

function allowlists(overrides: Partial<RoleAllowlists> = {}): RoleAllowlists {
  return { admin: [], manager: [], viewer: [], ...overrides };
}

describe("resolveRoleFromUsername", () => {
  it("returns the matching role for a listed login", () => {
    expect(
      resolveRoleFromUsername("octocat", allowlists({ admin: ["octocat"] })),
    ).toBe("admin");
  });

  it("matches case-insensitively", () => {
    expect(
      resolveRoleFromUsername("OctoCat", allowlists({ admin: ["octocat"] })),
    ).toBe("admin");
  });

  it("ignores surrounding whitespace in both input and allowlist entries", () => {
    expect(
      resolveRoleFromUsername("  octocat  ", allowlists({ viewer: [" octocat "] })),
    ).toBe("viewer");
  });

  it("prefers admin over manager over viewer", () => {
    const lists = allowlists({
      admin: ["octocat"],
      manager: ["octocat"],
      viewer: ["octocat"],
    });
    expect(resolveRoleFromUsername("octocat", lists)).toBe("admin");
  });

  it("prefers manager over viewer", () => {
    const lists = allowlists({ manager: ["octocat"], viewer: ["octocat"] });
    expect(resolveRoleFromUsername("octocat", lists)).toBe("manager");
  });

  it("falls back to DEFAULT_ROLE for an unlisted login", () => {
    expect(resolveRoleFromUsername("nobody", allowlists({ admin: ["octocat"] }))).toBe("member");
  });

  it("falls back to DEFAULT_ROLE when every allowlist is empty", () => {
    expect(resolveRoleFromUsername("octocat", allowlists())).toBe("member");
  });

  it("falls back to DEFAULT_ROLE for an empty or whitespace login", () => {
    expect(resolveRoleFromUsername("", allowlists({ admin: ["octocat"] }))).toBe("member");
    expect(resolveRoleFromUsername("   ", allowlists({ admin: ["octocat"] }))).toBe("member");
  });
});
