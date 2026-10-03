import { NextRequest } from "next/server";
import { ConnectorStore } from "@/lib/mongodb/connector-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { config } from "@/lib/config";

const connectorStore = isDatabaseConfigured() ? new ConnectorStore() : null;

interface RouteParams {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!connectorStore) return api.serviceUnavailable("Database not configured");

        const { id } = await params;
        const server = await connectorStore.getConnector(id);

        if (!server) return api.notFound("Connector");
        if (server.userId !== user.id) return api.forbidden();

        return api.success(server);
    } catch (error) {
        return handleError(error, "Fetch connector");
    }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const existingServer = await connectorStore.getConnector(id);

        if (!existingServer) return api.notFound("Connector");
        if (existingServer.userId !== user.id) return api.forbidden();

        const body = await request.json();
        if (body.transportType && body.transportType !== "http" && body.transportType !== "sse") {
            return api.badRequest("Only HTTP and SSE transports are supported");
        }

        const updatedServer = await connectorStore.updateConnector(id, body);

        if (!updatedServer) return api.serverError("Failed to update connector");

        return api.success(updatedServer);
    } catch (error) {
        return handleError(error, "Update connector");
    }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

        const { id } = await params;
        const existingServer = await connectorStore.getConnector(id);

        if (!existingServer) return api.notFound("Connector");
        if (existingServer.userId !== user.id) return api.forbidden();

        const deleted = await connectorStore.deleteConnector(id);
        if (!deleted) return api.serverError("Failed to delete connector");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete connector");
    }
}
