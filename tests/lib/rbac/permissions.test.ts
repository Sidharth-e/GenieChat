import { describe, it, expect } from "vitest";
import {
  getPermissionsForRole,
  hasPermission,
  isValidRole,
  isRoleAtLeast,
} from "@/lib/rbac/permissions";

describe("getPermissionsForRole", () => {
  it("returns all 8 permissions for admin", () => {
    const perms = getPermissionsForRole("admin");
    expect(perms).toContain("users:manage");
    expect(perms).toContain("settings:admin");
    expect(perms).toContain("agents:write");
    expect(perms).toContain("prompts:write");
    expect(perms).toContain("tools:write");
    expect(perms).toContain("workflows:write");
    expect(perms).toContain("connector:write");
    expect(perms).toContain("chat:use");
    expect(perms).toHaveLength(8);
  });

  it("returns 6 permissions for manager (no users:manage or settings:admin)", () => {
    const perms = getPermissionsForRole("manager");
    expect(perms).not.toContain("users:manage");
    expect(perms).not.toContain("settings:admin");
    expect(perms).toContain("chat:use");
    expect(perms).toHaveLength(6);
  });

  it("returns 3 permissions for member", () => {
    const perms = getPermissionsForRole("member");
    expect(perms).toContain("agents:write");
    expect(perms).toContain("prompts:write");
    expect(perms).toContain("chat:use");
    expect(perms).toHaveLength(3);
  });

  it("returns only chat:use for viewer", () => {
    const perms = getPermissionsForRole("viewer");
    expect(perms).toEqual(["chat:use"]);
  });

  it("falls back to member permissions for an unknown role", () => {
    // @ts-expect-error — intentionally testing invalid role
    const perms = getPermissionsForRole("superadmin");
    expect(perms).toHaveLength(3);
    expect(perms).toContain("agents:write");
    expect(perms).toContain("prompts:write");
    expect(perms).toContain("chat:use");
  });
});

describe("hasPermission", () => {
  it("admin has every permission", () => {
    expect(hasPermission("admin", "users:manage")).toBe(true);
    expect(hasPermission("admin", "settings:admin")).toBe(true);
    expect(hasPermission("admin", "chat:use")).toBe(true);
  });

  it("viewer only has chat:use", () => {
    expect(hasPermission("viewer", "chat:use")).toBe(true);
    expect(hasPermission("viewer", "agents:write")).toBe(false);
    expect(hasPermission("viewer", "users:manage")).toBe(false);
  });

  it("member lacks settings:admin and users:manage", () => {
    expect(hasPermission("member", "settings:admin")).toBe(false);
    expect(hasPermission("member", "users:manage")).toBe(false);
    expect(hasPermission("member", "chat:use")).toBe(true);
  });

  it("manager lacks settings:admin and users:manage", () => {
    expect(hasPermission("manager", "settings:admin")).toBe(false);
    expect(hasPermission("manager", "users:manage")).toBe(false);
    expect(hasPermission("manager", "tools:write")).toBe(true);
  });
});

describe("isValidRole", () => {
  it("returns true for all valid roles", () => {
    expect(isValidRole("admin")).toBe(true);
    expect(isValidRole("manager")).toBe(true);
    expect(isValidRole("member")).toBe(true);
    expect(isValidRole("viewer")).toBe(true);
  });

  it("returns false for arbitrary strings", () => {
    expect(isValidRole("superadmin")).toBe(false);
    expect(isValidRole("")).toBe(false);
    expect(isValidRole("ADMIN")).toBe(false);
  });
});

describe("isRoleAtLeast", () => {
  it("admin is at least admin", () => {
    expect(isRoleAtLeast("admin", "admin")).toBe(true);
  });

  it("admin is at least viewer", () => {
    expect(isRoleAtLeast("admin", "viewer")).toBe(true);
  });

  it("viewer is not at least member", () => {
    expect(isRoleAtLeast("viewer", "member")).toBe(false);
  });

  it("member is not at least manager", () => {
    expect(isRoleAtLeast("member", "manager")).toBe(false);
  });

  it("manager is at least member", () => {
    expect(isRoleAtLeast("manager", "member")).toBe(true);
  });

  it("member is at least viewer", () => {
    expect(isRoleAtLeast("member", "viewer")).toBe(true);
  });

  it("viewer is at least viewer", () => {
    expect(isRoleAtLeast("viewer", "viewer")).toBe(true);
  });

  it("manager is at least manager", () => {
    expect(isRoleAtLeast("manager", "manager")).toBe(true);
  });

  it("member is at least member", () => {
    expect(isRoleAtLeast("member", "member")).toBe(true);
  });
});
