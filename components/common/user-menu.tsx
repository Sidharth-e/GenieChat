"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Settings,
  LogOut,
  Brain,
  Lock,
} from "lucide-react";
import { Avatar } from "@/components/common/avatar";
import { useAuthStore } from "@/lib/auth";
import Link from "next/link";
import { MCPIcon } from "@/components/common/custom-icons";
import { ADMIN_NAV_ITEM } from "@/constants/routes";
import { SecretListDialog } from "@/components/tools/secret-list-dialog";

interface UserMenuProps {
  variant?: "pill" | "avatar";
}

export function UserMenu({ variant = "pill" }: UserMenuProps) {
  const { user, signOutUser } = useAuthStore();
  const canAccessAdmin = user?.permissions?.includes("users:manage") ?? false;
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const isAvatar = variant === "avatar";

  return (
    <div ref={profileRef} className="relative">
      {isAvatar ? (
        <button
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          className={cn(
            "p-2 rounded-sm text-tertiary/50 hover:text-foreground hover:bg-tertiary/8 transition-colors cursor-pointer flex items-center justify-center",
            isProfileOpen && "bg-tertiary/8 text-foreground",
          )}
          aria-label="User menu"
        >
          <Avatar className="h-6 w-6" />
        </button>
      ) : (
        <button
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          className={cn(
            "flex items-center gap-2 rounded-full pl-1 pr-3 py-1 cursor-pointer",
            "text-[0.8125rem] font-medium transition-all duration-200 h-9 border focus:outline-none focus:ring-2 focus:ring-primary/10",
            isProfileOpen
              ? "bg-tertiary/10 text-foreground border-transparent shadow-sm"
              : "text-foreground/80 bg-tertiary/5 border-tertiary/8 hover:bg-tertiary/10 hover:text-foreground hover:border-transparent",
          )}
        >
          <Avatar className="h-6 w-6" />
          <span className="max-w-[120px] truncate hidden md:inline">
            {user.name}
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 opacity-50 transition-transform duration-200",
              isProfileOpen && "rotate-180 opacity-100",
            )}
          />
        </button>
      )}

      <AnimatePresence>
        {isProfileOpen && (
          <motion.div
            initial={
              isAvatar
                ? { opacity: 0, x: -6, scale: 0.97 }
                : { opacity: 0, y: -6, scale: 0.97 }
            }
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={
              isAvatar
                ? { opacity: 0, x: -6, scale: 0.97 }
                : { opacity: 0, y: -6, scale: 0.97 }
            }
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={cn(
              "min-w-[240px] rounded-lg border border-card-border bg-dropdown-bg shadow-xl z-50 p-1.5",
              isAvatar
                ? "absolute left-full bottom-0 ml-2"
                : "absolute right-0 top-full mt-2",
            )}
            style={{
              transformOrigin: isAvatar ? "bottom left" : "top right",
            }}
          >
            <div className="px-3 py-2 border-b border-card-border mb-1">
              <p className="text-sm font-medium text-foreground truncate">
                {user.name}
              </p>
              <p className="text-xs text-text-secondary truncate">
                {user.email}
              </p>
              {user.role && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                </p>
              )}
            </div>

            <Link
              href="/memories"
              className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-tertiary/10"
              onClick={() => setIsProfileOpen(false)}
            >
              <Brain className="h-4 w-4 text-tertiary/60" />
              Memories
            </Link>
            <Link
              href="/mcp"
              className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-tertiary/10"
              onClick={() => setIsProfileOpen(false)}
            >
              <MCPIcon className="h-4 w-4 text-tertiary/60" />
              MCP
            </Link>
            <button
              onClick={() => {
                setIsProfileOpen(false);
                setIsSecretDialogOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground transition-colors cursor-pointer hover:bg-tertiary/10"
            >
              <Lock className="h-4 w-4 text-tertiary/60" />
              Secrets
            </button>
            {canAccessAdmin && (
              <Link
                href={ADMIN_NAV_ITEM.href}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-tertiary/10"
                onClick={() => setIsProfileOpen(false)}
              >
                <ADMIN_NAV_ITEM.icon
                  className="h-4 w-4 text-tertiary/60"
                  strokeWidth={1.5}
                />
                {ADMIN_NAV_ITEM.label}
              </Link>
            )}
            <Link
              href="/settings"
              className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-tertiary/10"
              onClick={() => setIsProfileOpen(false)}
            >
              <Settings className="h-4 w-4 text-tertiary/60" />
              Settings
            </Link>

            <div className="my-1 h-px bg-card-border" />

            <button
              onClick={() => signOutUser()}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-sm font-medium text-[var(--red)] transition-colors cursor-pointer hover:bg-[var(--red-bg)]"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <SecretListDialog
        isOpen={isSecretDialogOpen}
        onClose={() => setIsSecretDialogOpen(false)}
      />
    </div>
  );
}
