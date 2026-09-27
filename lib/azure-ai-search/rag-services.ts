"use server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ChatDocumentStore } from "@/lib/mongodb/document-store";
import { ServerActionResponse } from "@/lib/types";
import { convertDocument } from "@/lib/docling";
import { RAG_MAX_UPLOAD_DOCUMENT_SIZE } from "@/constants/config";
import { generateId } from "@/lib/utils";
import { VectorAgentDocumentStore } from "./vector-agent-document-store";
import { CHAT_DOCUMENT_ATTRIBUTE, ChatDocumentModel } from "./models";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const CHUNK_SIZE = 2000; // 2kb
const CHUNK_OVERLAP = Math.floor(CHUNK_SIZE * 0.25); // 25% overlap

export type CrackDocumentResponse = {
    documents: string[];
    totalPages: number;
};

export const ReadDocument = async (
    formData: FormData
): Promise<ServerActionResponse<string>> => {
    try {
        const store = new VectorAgentDocumentStore();
        const response = await store.ensureIndexExists();
        if (response.status === "OK") {
            const file = formData.get("file") as unknown as File | null;
            if (!file) {
                return { status: "ERROR", errors: [{ message: "No file provided" }] };
            }

            const fileResponse = await convertDocument(
                Buffer.from(await file.arrayBuffer()),
                file.name,
                file.type || "",
            );

            if (fileResponse.status === "OK") {
                return {
                    status: "OK",
                    response: fileResponse.response.documents.join("\n"),
                };
            }

            return {
                status: "ERROR",
                errors: fileResponse.errors || [{ message: "Error loading file" }]
            };
        }

        return {
            status: "ERROR",
            errors: response.errors || [{ message: "Failed to ensure index exists" }]
        };
    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export const CrackDocument = async (
    formData: FormData
): Promise<ServerActionResponse<CrackDocumentResponse>> => {
    try {
        const store = new VectorAgentDocumentStore();
        const response = await store.ensureIndexExists();
        if (response.status === "OK") {
            const file = formData.get("file") as unknown as File | null;
            if (!file) {
                return { status: "ERROR", errors: [{ message: "No file provided" }] };
            }
            // The route above enforces this too, but this is an exported server
            // action, so nothing stops another caller from reaching the buffer
            // and base64 below without that check.
            if (file.size > RAG_MAX_UPLOAD_DOCUMENT_SIZE) {
                const maxSizeMB = Math.floor(RAG_MAX_UPLOAD_DOCUMENT_SIZE / (1024 * 1024));
                return {
                    status: "ERROR",
                    errors: [{ message: `File too large. Maximum size is ${maxSizeMB}MB` }],
                };
            }

            const fileResponse = await convertDocument(
                Buffer.from(await file.arrayBuffer()),
                file.name,
                file.type || "",
            );
            const chatThreadId = formData.get("chatThreadId") as string;
            const agentId = formData.get("agentId") as string;
            const sessionUser = await getSessionUser();

            if (fileResponse.status === "OK") {
                const splitDocuments = await ChunkDocumentWithOverlap(
                    fileResponse.response.documents.join("\n")
                );

                // Index the documents if chatThreadId or agentId is present (implies context awareness)
                if ((chatThreadId || agentId) && sessionUser) {
                    logger.info(`[CrackDocument] Indexing for User: ${sessionUser.id}, Agent: ${agentId}, Thread: ${chatThreadId}`);

                    const documentsToIndex = splitDocuments.map((chunk) => ({
                        id: generateId(),
                        content: chunk,
                        title: fileResponse.response.filename,
                        filepath: fileResponse.response.filename,
                        chatThreadId: chatThreadId || "",
                        agentId: agentId || "",
                        userId: sessionUser.id,
                        chunk: chunk
                    }));
                    
                    logger.info(`[CrackDocument] About to index ${documentsToIndex.length} documents`);
                    const indexResult = await store.indexDocuments(documentsToIndex);
                    logger.info(`[CrackDocument] indexDocuments result:`, JSON.stringify(indexResult));

                    // Also save metadata to MongoDB
                    logger.info("[CrackDocument] Calling CreateChatDocument...");
                    await CreateChatDocument(
                        fileResponse.response.filename,
                        chatThreadId || "",
                        fileResponse.response.documents.join("\n"),
                        0,
                        fileResponse.response.totalPages,
                        documentsToIndex.length,
                        Date.now(),
                        agentId
                    );
                } else {
                    logger.info("[CrackDocument] Skipping indexing. Missing context:", { chatThreadId, agentId, hasUser: !!sessionUser });
                }

                return {
                    status: "OK",
                    response: {
                        documents: splitDocuments,
                        totalPages: fileResponse.response.totalPages,
                    },
                };
            }

            return {
                status: "ERROR",
                errors: fileResponse.errors || [{ message: "Error loading file" }]
            };
        }

        return {
            status: "ERROR",
            errors: response.errors || [{ message: "Failed to ensure index exists" }]
        };
    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export const FindAllChatDocuments = async (
    chatThreadID: string
): Promise<ServerActionResponse<ChatDocumentModel[]>> => {
    try {
        const chatDocumentStore = new ChatDocumentStore();
        const documents = await chatDocumentStore.findAllChatDocuments(
            chatThreadID
        );

        return {
            status: "OK",
            response: documents,
        };
    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export const FindChatDocumentWithName = async (
    chatThreadID: string,
    docName: string
): Promise<ServerActionResponse<ChatDocumentModel[]>> => {
    try {
        const chatDocumentStore = new ChatDocumentStore();
        const document = await chatDocumentStore.findChatDocumentByName(
            chatThreadID,
            docName
        );

        return {
            status: "OK",
            response: document ? [document] : [],
        };
    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export const FindChatDocument = async (
    chatThreadID: string,
    documentID: string,
): Promise<ServerActionResponse<ChatDocumentModel>> => {
    try {
        const chatDocumentStore = new ChatDocumentStore();
        const document = await chatDocumentStore.findChatDocumentById(
            chatThreadID,
            documentID
        );

        if (!document) {
            return {
                status: "NOT_FOUND",
                errors: [
                    {
                        message: "Chat document not found",
                    },
                ],
            };
        }

        return {
            status: "OK",
            response: document,
        };

    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export const DeleteChatDocument = async (
    chatThreadID: string,
    documentID: string,
): Promise<ServerActionResponse<boolean>> => {
    try {
        const chatDocumentStore = new ChatDocumentStore();
        const chatDocument = await FindChatDocument(chatThreadID, documentID);

        if (chatDocument.status === "OK") {
            // The user comes from the document this read just resolved, not
            // from the caller: `DeleteChatDocument` has no user of its own, and
            // this is the same value the store checks ownership against.
            await chatDocumentStore.deleteDocument(
                chatThreadID,
                documentID,
                chatDocument.response.userId,
            );

            return {
                status: "OK",
                response: true,
            };
        }

        return {
            status: "ERROR",
            errors: [
                {
                    message: `Chat document not found`,
                },
            ]
        };
    } catch (error) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `Error deleting chat document: ${error}`,
                },
            ],
        };
    }
};

export const CreateChatDocument = async (
    fileName: string,
    chatThreadID: string,
    content?: string,
    promptTokens?: number,
    totalPages?: number,
    numberOfIndexes?: number,
    uploadTime?: number,
    agentId?: string,
): Promise<ServerActionResponse<ChatDocumentModel>> => {
    try {
        const user = await getSessionUser();
        if (!user) throw new Error("User not found");

        const modelToSave: ChatDocumentModel = {
            chatThreadId: chatThreadID,
            id: generateId(),
            userId: user.id,
            createdAt: new Date(),
            type: CHAT_DOCUMENT_ATTRIBUTE,
            isDeleted: false,
            name: fileName,
            content: content,
            promptTokens: promptTokens,
            totalPages: totalPages,
            numberOfIndexes: numberOfIndexes,
            uploadTime: uploadTime,
            agentId: agentId,
        };

        const chatDocumentStore = new ChatDocumentStore();
        logger.info("[CreateChatDocument] Saving to MongoDB:", modelToSave.id);
        const saved = await chatDocumentStore.upsertDocument(modelToSave);

        logger.info("[CreateChatDocument] Success:", saved.id);
        return {
            status: "OK",
            response: saved,
        };
    } catch (e) {
        return {
            status: "ERROR",
            errors: [
                {
                    message: `${e}`,
                },
            ],
        };
    }
};

export async function ChunkDocumentWithOverlap(
    document: string
): Promise<string[]> {
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
        separators: ["\n\n", "\n", ". ", " ", ""],
    });

    const chunks = await splitter.splitText(document);
    return chunks;
}
