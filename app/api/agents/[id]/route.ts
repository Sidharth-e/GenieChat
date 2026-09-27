import { NextRequest } from "next/server";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const { id } = await params;
        const agent = await agentStore.getAgent(id);

        if (!agent) return api.notFound("Agent");
        if (agent.userId !== user.id) return api.forbidden();

        return api.success(agent);
    } catch (error) {
        return handleError(error, "Fetch agent");
    }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const existingAgent = await agentStore.getAgent(id);

        if (!existingAgent) return api.notFound("Agent");
        if (existingAgent.userId !== user.id) return api.forbidden();

        const body = await request.json();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { userId: _u, id: _i, type: _t, createdAt: _c, ...safeBody } = body;
        const agent = await agentStore.updateAgent(id, safeBody);

        if (!agent) return api.serverError("Failed to update agent");

        return api.success(agent);
    } catch (error) {
        return handleError(error, "Update agent");
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const existingAgent = await agentStore.getAgent(id);

        if (!existingAgent) return api.notFound("Agent");
        if (existingAgent.userId !== user.id) return api.forbidden();

        const success = await agentStore.deleteAgent(id);
        if (!success) return api.serverError("Failed to delete agent");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete agent");
    }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const existingAgent = await agentStore.getAgent(id);

        if (!existingAgent) return api.notFound("Agent");
        if (existingAgent.userId !== user.id) return api.forbidden();

        const success = await agentStore.setActiveAgent(id, user.id);
        if (!success) return api.serverError("Failed to activate agent");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Activate agent");
    }
}
