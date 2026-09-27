"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Role } from "@/lib/rbac/types";

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

export const adminKeys = {
  all: ["admin"] as const,
  users: () => [...adminKeys.all, "users"] as const,
};

export function useAdminUsers() {
  return useQuery<UserRecord[]>({
    queryKey: adminKeys.users(),
    queryFn: async () => {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        if (response.status === 403) throw new Error("Access denied");
        throw new Error("Failed to fetch users");
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 2,
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation<UserRecord, Error, { userId: string; role: Role }>({
    mutationFn: async ({ userId, role }) => {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update role");
      }
      return response.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData<UserRecord[]>(adminKeys.users(), (old) =>
        old?.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
      );
    },
  });
}
