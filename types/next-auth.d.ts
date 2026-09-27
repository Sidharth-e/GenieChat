import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";
import { Role, Permission } from "../lib/rbac/types";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            email: string;
            isAdmin: boolean;
            role: Role;
            permissions: Permission[];
        } & DefaultSession["user"];
    }

    interface User extends DefaultUser {
        id: string;
        /** GitHub login. Present because the provider's profile() returns it. */
        login?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT extends DefaultJWT {
        id: string;
        email: string;
        login?: string;
        isAdmin?: boolean;
        role?: Role;
        permissions?: Permission[];
    }
}
