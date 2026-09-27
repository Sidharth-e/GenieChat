import { logger } from "@/lib/logger";
import "server-only";
import { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { config, isDatabaseConfigured } from "@/lib/config";
import { Role, Permission, DEFAULT_ROLE } from "@/lib/rbac/types";
import { getPermissionsForRole } from "@/lib/rbac/permissions";
import { resolveRoleFromUsername } from "@/lib/auth/role-resolution";
import { UserStore } from "@/lib/mongodb/user-store";

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub omits `email` from /user when the address is private, so the provider's
 * profile() falls back to /user/emails. That endpoint needs the `user:email`
 * scope, which is in the GitHub provider's default scope set.
 */
async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      logger.error(`GitHub /user/emails failed (status=${response.status}).`);
      return null;
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return null;
    }

    const verified = (payload as GitHubEmail[]).filter((entry) => entry?.verified);
    const preferred = verified.find((entry) => entry.primary) ?? verified[0];
    return preferred?.email ?? null;
  } catch (error) {
    logger.error(
      "Failed to fetch GitHub primary email:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

const userStore = isDatabaseConfigured() ? new UserStore() : null;

async function resolveUserRole(
  userId: string,
  email: string,
  name: string,
  image: string | null | undefined,
  login: string,
): Promise<{ role: Role; permissions: Permission[] }> {
  // An existing record's role wins, so promoting someone in the database
  // survives every subsequent sign-in.
  const allowlists = {
    admin: config.auth.github.adminUsernames,
    manager: config.auth.github.managerUsernames,
    viewer: config.auth.github.viewerUsernames,
  };

  let role: Role = DEFAULT_ROLE;

  if (userStore) {
    const existingUser = await userStore.getUser(userId);
    role = existingUser ? existingUser.role : resolveRoleFromUsername(login, allowlists);

    try {
      await userStore.upsertUser({ id: userId, email, name, image: image ?? null, role });
    } catch (error) {
      logger.error("Failed to upsert user record:", error instanceof Error ? error.message : error);
    }
  } else {
    role = resolveRoleFromUsername(login, allowlists);
  }

  return { role, permissions: getPermissionsForRole(role) };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: config.auth.github.clientId ?? "",
      clientSecret: config.auth.github.clientSecret ?? "",
      async profile(profile, tokens) {
        const email: string | null =
          profile.email ?? (tokens?.access_token
            ? await fetchPrimaryEmail(tokens.access_token)
            : null);

        if (!email) {
          logger.error(`No email resolved for GitHub login "${profile.login}".`);
        }

        return {
          id: profile.id.toString(),
          name: profile.name ?? profile.login,
          email,
          image: profile.avatar_url,
          login: profile.login,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, account, user }) {
      // Initial sign in. GitHub OAuth App tokens do not expire and there is no
      // refresh token, so there is nothing to refresh on later invocations.
      if (account && user) {
        const login = user.login ?? "";
        const { role, permissions } = await resolveUserRole(
          user.id,
          user.email || "",
          user.name || "",
          user.image,
          login,
        );

        return {
          ...token,
          id: user.id,
          email: user.email || "",
          login,
          isAdmin: role === "admin",
          role,
          permissions,
        };
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.role = (token.role as Role) ?? DEFAULT_ROLE;
        session.user.permissions =
          (token.permissions as Permission[]) ?? getPermissionsForRole(DEFAULT_ROLE);
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: config.auth.nextAuthSecret,
};
