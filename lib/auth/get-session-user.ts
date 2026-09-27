import { logger } from "@/lib/logger";
import "server-only";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./config";
import { Role, Permission, DEFAULT_ROLE } from "@/lib/rbac/types";
import { getPermissionsForRole } from "@/lib/rbac/permissions";

export interface SessionUser {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    role: Role;
    permissions: Permission[];
    image?: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return null;
        }
        const role = session.user.role ?? DEFAULT_ROLE;
        return {
            id: session.user.id,
            email: session.user.email || "",
            name: session.user.name || "",
            isAdmin: role === "admin",
            role,
            permissions: session.user.permissions ?? getPermissionsForRole(role),
            image: session.user.image,
        };
    } catch (error) {
        logger.error("Error getting session user:", error);
        return null;
    }
}

export async function requireAuth(): Promise<SessionUser> {
    const user = await getSessionUser();
    if (!user) {
        throw new Error("Unauthorized");
    }
    return user;
}
