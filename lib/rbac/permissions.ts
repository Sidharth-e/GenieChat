import "server-only";

import { Role, Permission, ROLES } from "./types";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set([
    "users:manage",
    "settings:admin",
    "agents:write",
    "prompts:write",
    "tools:write",
    "workflows:write",
    "mcp:write",
    "chat:use",
  ]),
  manager: new Set([
    "agents:write",
    "prompts:write",
    "tools:write",
    "workflows:write",
    "mcp:write",
    "chat:use",
  ]),
  member: new Set([
    "agents:write",
    "prompts:write",
    "chat:use",
  ]),
  viewer: new Set([
    "chat:use",
  ]),
};

export function getPermissionsForRole(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.member)];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

const ROLE_RANK: Record<Role, number> = {
  admin: 3,
  manager: 2,
  member: 1,
  viewer: 0,
};

export function isRoleAtLeast(userRole: Role, minimumRole: Role): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[minimumRole] ?? 0);
}
