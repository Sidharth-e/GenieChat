import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { UserStore } from "@/lib/mongodb/user-store";
import { requirePermission, isNextResponse } from "@/lib/rbac/guards";
import { api, handleError } from "@/lib/api-utils";

const userStore = isDatabaseConfigured() ? new UserStore() : null;

export async function GET() {
  try {
    const result = await requirePermission("users:manage");
    if (isNextResponse(result)) return result;
    if (!userStore) return api.serviceUnavailable("Database not configured");

    const existing = await userStore.getUser(result.id);
    if (!existing) {
      await userStore.upsertUser({
        id: result.id,
        email: result.email,
        name: result.name,
        role: result.role,
      });
    }

    const users = await userStore.getAllUsers();
    return api.success(users);
  } catch (error) {
    return handleError(error, "List users");
  }
}
