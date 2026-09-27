import { NextRequest } from "next/server";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;

export async function GET() {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const agents = await agentStore.getAgents(user.id);
        return api.success(agents);
    } catch (error) {
        return handleError(error, "Fetch agents");
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "agents_write",
            identifier: user.id,
            ...config.rateLimit.standard,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const body = await request.json();
        const { name, description, systemPrompt, tools, modelId, temperature, topP, subAgents, skills, documents } = body;

        if (!name || !description) return api.badRequest("Name and description are required");

        const agent = await agentStore.createAgent({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            name,
            description,
            active: true,
            systemPrompt,
            tools: tools || [],
            modelId,
            temperature,
            topP,
            subAgents: subAgents || [],
            skills: skills || [],
            documents: documents || [],
        });

        return api.created(agent);
    } catch (error) {
        return handleError(error, "Create agent");
    }
}
