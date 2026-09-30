"use client";

import { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { ContentLayout } from "@/components/common/content-layout";
import { ContentFilterPills } from "@/components/common/content-filter-pills";
import { UserTable } from "./user-table";
import { useAdminUsers } from "@/hooks/use-admin-queries";
import { useAuthStore } from "@/lib/auth";
import { ROLES, Role } from "@/lib/rbac/types";
import { ROLE_META } from "./role-badge";

export function AdminContent() {
  const user = useAuthStore((s) => s.user);
  const { data: users, isLoading, error } = useAdminUsers();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");

  if (!user?.permissions?.includes("users:manage")) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-text-secondary mx-auto" />
          <p className="text-lg font-medium text-foreground">Access Denied</p>
          <p className="text-sm text-text-secondary">
            You do not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  const filteredUsers = users?.filter((u) => {
    const matchesSearch =
      !searchQuery ||
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const roleCounts = users?.reduce(
    (acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <ContentLayout
      title="Admin"
      description="Manage users and their roles across the organization"
      searchPlaceholder="Search by name or email..."
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      navigation={
        <ContentFilterPills
          ariaLabel="Filter users by role"
          options={[
            { value: "all" as const, label: "All Users", count: users?.length },
            ...ROLES.map((role) => ({
              value: role,
              label: ROLE_META[role].label,
              icon: ROLE_META[role].icon,
              count: roleCounts?.[role],
            })),
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
      }
    >
      {isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800/30 dark:bg-red-900/10 p-6 text-center">
          <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-700 dark:text-red-400">
            {error.message}
          </p>
        </div>
      )}
      {filteredUsers && filteredUsers.length > 0 && (
        <UserTable users={filteredUsers} />
      )}
      {filteredUsers && filteredUsers.length === 0 && !isLoading && (
        <div className="rounded-xl border border-dashed border-card-border bg-card-bg p-10 text-center">
          <p className="text-sm text-text-secondary">
            No users match your search.
          </p>
        </div>
      )}
    </ContentLayout>
  );
}
