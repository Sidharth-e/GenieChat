"use client";

import { Role } from "@/lib/rbac/types";
import { cn } from "@/lib/utils";
import { Shield, ShieldCheck, User, Eye } from "lucide-react";

const ROLE_CONFIG: Record<Role, { label: string; icon: typeof Shield; className: string }> = {
  admin: {
    label: "Admin",
    icon: ShieldCheck,
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  manager: {
    label: "Manager",
    icon: Shield,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  member: {
    label: "Member",
    icon: User,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  viewer: {
    label: "Viewer",
    icon: Eye,
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  },
};

interface RoleBadgeProps {
  role: Role;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.member;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        config.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
