import { getConfiguredModels } from "@/lib/langchain/model-factory";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api } from "@/lib/api-utils";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return api.unauthorized();

  return api.success(getConfiguredModels());
}
