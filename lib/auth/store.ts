"use client";

import { logger } from "@/lib/logger";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { signIn, signOut, getSession } from "next-auth/react";
import { Role, Permission } from "@/lib/rbac/types";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  role: Role;
  permissions: Permission[];
  image?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  initialize: () => Promise<void>;
  signInWithGitHub: (callbackUrl?: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,

      initialize: async () => {
        try {
          set({ isLoading: true });
          const session = await getSession();
          if (session?.user) {
            const role = session.user.role ?? "member";
            set({
              user: {
                id: session.user.id,
                email: session.user.email || "",
                name: session.user.name || "",
                isAdmin: role === "admin",
                role,
                permissions: session.user.permissions ?? [],
                image: session.user.image,
              },
              isAuthenticated: true,
            });
          } else {
            set({ user: null, isAuthenticated: false });
          }
        } catch (error) {
          logger.error("Failed to initialize auth:", error);
          set({ user: null, isAuthenticated: false });
        } finally {
          set({ isLoading: false });
        }
      },

      signInWithGitHub: async (callbackUrl = "/") => {
        try {
          await signIn("github", { callbackUrl });
        } catch (error) {
          logger.error("GitHub sign-in failed:", error);
          throw error;
        }
      },

      signOutUser: async () => {
        try {
          await signOut({ callbackUrl: "/login" });
          set({ user: null, isAuthenticated: false });
        } catch (error) {
          logger.error("Sign-out failed:", error);
          throw error;
        }
      },

      setUser: (user: AuthUser | null) => {
        set({ user, isAuthenticated: !!user });
      },
    }),
    {
      name: "auth-storage",
      version: 2,
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
