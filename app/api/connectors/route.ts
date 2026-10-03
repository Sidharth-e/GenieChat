import { NextRequest } from "next/server";
import { ConnectorStore } from "@/lib/mongodb/connector-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const connectorStore = isDatabaseConfigured() ? new ConnectorStore() : null;

export async function GET() {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!connectorStore) return api.serviceUnavailable("Database not configured");

        const servers = await connectorStore.getConnectors(user.id);
        return api.success(servers);
    } catch (error) {
        return handleError(error, "Fetch connectors");
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!connectorStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "connector_write",
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
        const {
            name,
            description,
            transportType,
            serverUrl,
            headers,
            timeout,
            requireApproval,
        } = body;

        if (!name || !transportType) {
            return api.badRequest("Name and transport type are required");
        }

        if (transportType !== "http" && transportType !== "sse") {
            return api.badRequest("Only HTTP and SSE transports are supported");
        }

        if ((transportType === "http" || transportType === "sse") && !serverUrl) {
            return api.badRequest("Connector URL is required for HTTP/SSE transport");
        }

        const server = await connectorStore.createConnector({
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            name,
            description,
            transportType,
            serverUrl,
            headers: headers || {},
            enabled: true,
            timeout: timeout || 30000,
            requireApproval: requireApproval || "never",
        });

        return api.created(server);
    } catch (error) {
        return handleError(error, "Create connector");
    }
}
