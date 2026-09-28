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
        // The document row and its chunks are stored under the id generated
        // above, so the DELETE handler below can address them by the same value
        // it finds in `agent.documents`.
        ragFormData.append("documentId", documentId);

        let indexFailed = false;
        let indexErrorMessage = "Failed to index document for knowledge base";

        try {
            const { CrackDocument } = await import("@/lib/knowledge/documents");
            const indexResult = await CrackDocument(ragFormData);
            if (indexResult.status === "OK") {
                logger.info(`[AgentFiles] Successfully indexed document for agent ${agentId}`);
            } else {
                indexFailed = true;
                indexErrorMessage = indexResult.errors?.[0]?.message || indexErrorMessage;
                logger.error({ err: indexResult.errors }, `[AgentFiles] Failed to index document for agent ${agentId}`);
            }
        } catch (err) {
            indexFailed = true;
            indexErrorMessage = err instanceof Error ? err.message : indexErrorMessage;
            logger.error({ err }, "[AgentFiles] Error indexing document");
        }

        if (indexFailed) {
            await deleteObject(uploadResult.response).catch((delErr) => {
                logger.error({ err: delErr }, "[AgentFiles] Failed to clean up object after indexing failure");
            });
            return api.error(indexErrorMessage, 422);
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

        // Removing the stored object is not enough to remove the document: its
        // text and its chunks are what `knowledge_base_search` actually reads,
        // so a file deleted here would otherwise keep answering questions.
        // `DeleteChatDocument` clears both stores, and it finds them because the
        // upload indexed under this same `documentId`.
        //
        // Deliberately before the agent's document list is pruned: a genuine
        // failure leaves the file listed so the user can retry, and the retry is
        // safe because the object delete above tolerates an already-missing
        // object. What must NOT retain the file is the absence of a document row
        // -- the shape an upload has when docling could not parse it, since the
        // file is attached either way. The object is already gone by this point,
        // so retaining it there would strand the entry with nothing left to
        // clear and fail every retry the same way.
        try {
            const { DeleteChatDocument } = await import("@/lib/knowledge/documents");
            const { decideAgentDocumentDelete } = await import("@/lib/knowledge/types");
            const forgotten = await DeleteChatDocument("", documentId);
            if (decideAgentDocumentDelete(forgotten.status) === "retain") {
                logger.error(
                    { forgotten },
                    `[AgentFiles] Failed to delete the document and chunks for ${documentId}`,
                );
                return api.serverError("Failed to delete document");
            }
            if (forgotten.status === "NOT_FOUND") {
                logger.info(
                    { documentId },
                    "[AgentFiles] No document row to clear; the file was attached without being indexed",
                );
            }
        } catch (err) {
            logger.error({ err }, `[AgentFiles] Error deleting document ${documentId}`);
            return api.serverError("Failed to delete document");
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
