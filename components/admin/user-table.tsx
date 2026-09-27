"use client";

import { useState } from "react";
import { Role, ROLES } from "@/lib/rbac/types";
import { RoleBadge } from "./role-badge";
import { useUpdateUserRole } from "@/hooks/use-admin-queries";
import { useAuthStore } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface UserRecord {
  id: string;
  userId: string;
  email: string;
  name: string;
  image?: string | null;
  role: Role;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

interface UserTableProps {
  users: UserRecord[];
}

export function UserTable({ users }: UserTableProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role>("member");
  const updateRole = useUpdateUserRole();

  const startEditing = (user: UserRecord) => {
    setEditingUserId(user.id);
    setSelectedRole(user.role);
  };

  const cancelEditing = () => {
    setEditingUserId(null);
  };

  const saveRole = async (userId: string) => {
    await updateRole.mutateAsync({ userId, role: selectedRole });
    setEditingUserId(null);
  };

  return (
    <div className="rounded-xl border border-card-border bg-card-bg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-surface-muted/50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Role
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary hidden md:table-cell">
                Last Active
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary hidden lg:table-cell">
                Joined
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {users.map((user) => {
              const isEditing = editingUserId === user.id;
              const isSelf = user.id === currentUser?.id;

              return (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-hover-bg"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                        {user.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {user.name || "Unknown"}
                          {isSelf && (
                            <span className="ml-1.5 text-xs text-text-secondary">(you)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-text-secondary">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={selectedRole}
                          onChange={(v) => setSelectedRole(v as Role)}
                          options={ROLES.map((r) => ({
                            value: r,
                            label: r.charAt(0).toUpperCase() + r.slice(1),
                          }))}
                          size="sm"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => saveRole(user.id)}
                          disabled={updateRole.isPending}
                        >
                          {updateRole.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={cancelEditing}
                          disabled={updateRole.isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(user)}
                        className={cn(
                          "cursor-pointer rounded-lg p-1 -m-1 transition-colors hover:bg-hover-bg",
                          isSelf && "pointer-events-none opacity-60",
                        )}
                        disabled={isSelf}
                        title={isSelf ? "You cannot change your own role" : "Click to change role"}
                      >
                        <RoleBadge role={user.role} />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary hidden md:table-cell">
                    {formatDate(user.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary hidden lg:table-cell">
                    {formatDate(user.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
