export const ROLES = ["admin", "manager", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "users:manage",
  "settings:admin",
  "agents:write",
  "prompts:write",
  "tools:write",
  "workflows:write",
  "mcp:write",
  "chat:use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLE: Role = "member";
