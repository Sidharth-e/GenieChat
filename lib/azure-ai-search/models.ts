
export const CHAT_DOCUMENT_ATTRIBUTE = "CHAT_DOCUMENT";
export const CHAT_CITATION_ATTRIBUTE = "CHAT_CITATION";

export interface ChatDocumentModel {
    id: string;
    userId: string;
    chatThreadId: string;
    createdAt: Date;
    type: string;
    isDeleted: boolean;
    name: string;
    content?: string;
    promptTokens?: number;
    totalPages?: number;
    numberOfIndexes?: number;
    uploadTime?: number;
    agentId?: string;
}

export interface ChatCitationModel {
    id: string;
    userId: string;
    chatThreadId: string;
    createdAt: Date;
    type: string;
    content: DocumentSearchResponse;
}

export interface DocumentSearchResponse {
    score: number;
    document: {
        metadata?: Record<string, unknown> | string;
        title?: string;
        pageContent?: string;
        content?: string;
        chunk?: string;
        chatThreadId?: string;
        agentId?: string;
        filename?: string;
        filepath?: string;
        [key: string]: unknown;
    };
}
