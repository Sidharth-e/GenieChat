import { DEFAULT_ROLE, type Role } from "@/lib/rbac/types";

export interface RoleAllowlists {
  admin: string[];
  manager: string[];
  viewer: string[];
}

/** Highest privilege first — the first match wins. */
const ROLE_PRECEDENCE = ["admin", "manager", "viewer"] as const;

function normalize(login: string): string {
  return login.trim().toLowerCase();
}

/**
 * Maps a GitHub login to a role from the configured allowlists.
 *
 * GitHub logins are case-insensitive, so comparison normalizes case and
 * surrounding whitespace on both sides. An unlisted or empty login is not an
 * error — it falls back to DEFAULT_ROLE.
 */
export function resolveRoleFromUsername(
  login: string,
  allowlists: RoleAllowlists,
): Role {
  const candidate = normalize(login ?? "");
  if (!candidate) {
    return DEFAULT_ROLE;
  }

  for (const role of ROLE_PRECEDENCE) {
    if (allowlists[role]?.some((entry) => normalize(entry) === candidate)) {
      return role;
    }
  }

  return DEFAULT_ROLE;
}
