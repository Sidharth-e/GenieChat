import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { putObject, deleteObject } from "@/lib/storage";
import { keyForUser } from "@/lib/storage/ref";
import { STORAGE_BUCKETS } from "@/constants/storage";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { AgentDocument } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { config } from "@/lib/config";
import { api, handleError } from "@/lib/api-utils";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { RAG_MAX_UPLOAD_DOCUMENT_SIZE } from "@/constants/config";
import { getFileExtension, isSupportedDocumentFile } from "@/lib/document-file-support";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const MAX_AGENT_DOCUMENT_SIZE = RAG_MAX_UPLOAD_DOCUMENT_SIZE;

function sanitizeFileName(name: string): string {
    return (
        name
            .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180) || "file"
    );
}

function isAllowedAgentDocument(file: File): boolean {
    return isSupportedDocumentFile(file);
}

export async function POST(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const rateLimit = await checkRateLimit(request, {
            namespace: "agent_file_upload",
            identifier: user.id,
            ...config.rateLimit.strict,
        });
        if (!rateLimit.allowed) {
            return api.tooManyRequests(
                `Too many agent document upload requests. Retry after ${rateLimit.retryAfterSeconds}s`,
                rateLimit.retryAfterSeconds,
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const agentId = formData.get("agentId") as string | null;

        if (!file || !agentId) return api.badRequest("File and agentId are required");
        if (file.size <= 0) return api.badRequest("File is empty");
        if (!isAllowedAgentDocument(file)) {
            return api.badRequest(
                `Unsupported file type: ${file.type || getFileExtension(file.name) || "unknown"}`,
            );
        }
        if (file.size > MAX_AGENT_DOCUMENT_SIZE) {
            const maxSizeMB = Math.floor(MAX_AGENT_DOCUMENT_SIZE / (1024 * 1024));
            return api.badRequest(`File too large. Maximum size is ${maxSizeMB}MB`);
        }

        const agent = await agentStore.getAgent(agentId);
        if (!agent) return api.notFound("Agent");
        if (agent.userId !== user.id) return api.forbidden();

        const buffer = Buffer.from(await file.arrayBuffer());
        const documentId = generateId();
        const safeFileName = sanitizeFileName(file.name);
        const key = keyForUser(user.id, agentId, `${documentId}-${safeFileName}`);

        const uploadResult = await putObject(
            STORAGE_BUCKETS.agentDocuments,
            key,
            buffer,
        );

        if (uploadResult.status !== "OK") {
            logger.error({ err: uploadResult }, "[AgentFiles] Upload failed");
            return api.serverError("Failed to upload file");
        }

        const newDocument: AgentDocument = {
            id: documentId,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            ref: uploadResult.response,
            uploadedAt: new Date().toISOString(),
        };

        const ragFormData = new FormData();
        ragFormData.append("file", file);
        ragFormData.append("agentId", agentId);

        try {
            const { CrackDocument } = await import("@/lib/knowledge/documents");
            const indexResult = await CrackDocument(ragFormData);
            if (indexResult.status === "OK") {
                logger.info(`[AgentFiles] Successfully indexed document for agent ${agentId}`);
            } else {
                logger.error({ err: indexResult.errors }, `[AgentFiles] Failed to index document for agent ${agentId}`);
            }
        } catch (err) {
            logger.error({ err: err }, "[AgentFiles] Error indexing document");
        }

        const existingDocuments = agent.documents || [];
        const updatedAgent = await agentStore.updateAgent(agentId, {
            documents: [...existingDocuments, newDocument],
        });

        if (!updatedAgent) return api.serverError("Failed to update agent");

        return api.created(newDocument);
    } catch (error) {
        return handleError(error, "Upload agent file");
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const { searchParams } = new URL(request.url);
        const agentId = searchParams.get("agentId");

        if (!agentId) return api.badRequest("agentId is required");

        const agent = await agentStore.getAgent(agentId);
        if (!agent) return api.notFound("Agent");
        if (agent.userId !== user.id) return api.forbidden();

        return api.success(agent.documents || []);
    } catch (error) {
        return handleError(error, "List agent files");
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await getSessionUser();
        if (!user) return api.unauthorized();
        if (!agentStore) return api.serviceUnavailable("Database not configured");

        const body = await request.json();
        const { agentId, documentId } = body;

        if (!agentId || !documentId) return api.badRequest("agentId and documentId are required");

        const agent = await agentStore.getAgent(agentId);
        if (!agent) return api.notFound("Agent");
        if (agent.userId !== user.id) return api.forbidden();

        const existingDocuments = agent.documents || [];
        const documentToDelete = existingDocuments.find(d => d.id === documentId);

        if (!documentToDelete) return api.notFound("Document");

        const deleteResult = await deleteObject(documentToDelete.ref);
        // `!== "OK"` rather than `=== "ERROR"`: `NOT_CONFIGURED` carries the
        // "ERROR" status, so it was already caught, but `NOT_FOUND` — a missing
        // bucket — was dropped silently, leaving the object behind with no log
        // line for an audit to find.
        if (deleteResult.status !== "OK") {
            logger.error({ err: deleteResult }, "[AgentFiles] Delete object failed");
        }

        const updatedDocuments = existingDocuments.filter(d => d.id !== documentId);
        const updatedAgent = await agentStore.updateAgent(agentId, {
            documents: updatedDocuments,
        });

        if (!updatedAgent) return api.serverError("Failed to update agent");

        return api.success({ success: true });
    } catch (error) {
        return handleError(error, "Delete agent file");
    }
}
