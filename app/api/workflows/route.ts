import { WorkflowStore } from "@/lib/mongodb/workflow-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";

const workflowStore = isDatabaseConfigured() ? new WorkflowStore() : null;

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();
    if (!workflowStore)
      return api.serviceUnavailable("Database not configured");

    const workflows = await workflowStore.getRichWorkflows(user.id);

    // createdAt-descending: the list renders newest-first.
    const sorted = [...workflows].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return api.success(sorted);
  } catch (error) {
    return handleError(error, "Fetch workflows");
  }
}
