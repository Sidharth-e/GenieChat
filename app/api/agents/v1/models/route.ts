import { NextRequest } from "next/server";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { authenticateApiKey, hasAgentAccess } from "@/lib/api/agent-api-auth";
import { api, handleError } from "@/lib/api-utils";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateApiKey(req);
    if (!auth.authenticated || !auth.apiKey) {
      return api.unauthorized(auth.error || "Unauthorized");
    }

    if (!agentStore) return api.serviceUnavailable("Database not configured");

    const agents = await agentStore.getAgents(auth.apiKey.userId);
    const accessibleAgents = agents.filter((a) =>
      hasAgentAccess(auth.apiKey!, a.id),
    );

    const models = accessibleAgents.map((agent) => ({
      id: agent.id,
      object: "model",
      created: Math.floor(new Date(agent.createdAt).getTime() / 1000),
      owned_by: agent.userName || "user",
      name: agent.name,
      description: agent.description,
    }));

    return api.success({ object: "list", data: models });
  } catch (error) {
    return handleError(error, "List agent models");
  }
}
