import "server-only";

import { NextResponse } from "next/server";
import { getSessionUser, SessionUser } from "@/lib/auth/get-session-user";
import { Permission, Role } from "./types";
import { hasPermission, isRoleAtLeast } from "./permissions";
import { api } from "@/lib/api-utils";

interface AuthorizedUser extends SessionUser {
  role: Role;
  permissions: Permission[];
}

export async function requirePermission(
  permission: Permission,
): Promise<AuthorizedUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return api.unauthorized();
  if (!hasPermission(user.role, permission)) {
    return api.forbidden("You do not have permission to perform this action");
  }
  return user as AuthorizedUser;
}

export async function requireRole(
  minimumRole: Role,
): Promise<AuthorizedUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return api.unauthorized();
  if (!isRoleAtLeast(user.role, minimumRole)) {
    return api.forbidden("Insufficient role for this action");
  }
  return user as AuthorizedUser;
}

export function isNextResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
