
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ServerActionResponse } from "@/lib/types";
import { ChatCitationStore } from "@/lib/mongodb/document-store";
import { generateId } from "@/lib/utils";
import { DocumentSearchResponse, CHAT_CITATION_ATTRIBUTE, ChatCitationModel } from "./models";

export const CreateCitation = async (
    model: ChatCitationModel
): Promise<ServerActionResponse<ChatCitationModel>> => {
    try {
        const chatCitationStore = new ChatCitationStore();
        const citation = await chatCitationStore.createCitation(model);

        return {
            status: "OK",
            response: citation,
        };
    } catch (error) {
        return {
            status: "ERROR",
            errors: [{ message: `${error}` }],
        };
    }
};

// Create citations for the documents with a user as optional parameter
// when calling this method from the extension, you must provide the user as the REST API does not have access to the user
export const CreateCitations = async (
    models: DocumentSearchResponse[],
    userId?: string
): Promise<Array<ServerActionResponse<ChatCitationModel>>> => {
    const items: Array<Promise<ServerActionResponse<ChatCitationModel>>> = [];
    const currentUser = await getSessionUser();
    const currentUserId = userId || currentUser?.id;

    if (!currentUserId) {
        throw new Error("User ID is required to create citations");
    }

    for (const model of models) {
        const res = CreateCitation({
            content: model,
            id: generateId(),
            createdAt: new Date(),
            type: CHAT_CITATION_ATTRIBUTE,
            userId: currentUserId,
            chatThreadId: model.document.chatThreadId || "",
        });

        items.push(res);
    }

    return await Promise.all(items);
};

export const FindCitationByID = async (
    id: string
): Promise<ServerActionResponse<ChatCitationModel>> => {
    try {
        const user = await getSessionUser();
        if (!user) {
            return { status: "ERROR", errors: [{ message: "Unauthorized" }] };
        }

        const chatCitationStore = new ChatCitationStore();
        const citation = await chatCitationStore.findCitationById(id, user.id);

        if (!citation) {
            return {
                status: "ERROR",
                errors: [{ message: "Citation not found" }],
            };
        }

        return {
            status: "OK",
            response: citation,
        };
    } catch (error) {
        return {
            status: "ERROR",
            errors: [{ message: `${error}` }],
        };
    }
};

export const FormatCitations = (citation: DocumentSearchResponse[]) => {
    const withoutEmbedding: DocumentSearchResponse[] = [];
    citation.forEach((d) => {
        withoutEmbedding.push({
            score: d.score,
            document: {
                metadata: d.document.metadata || d.document.title,
                pageContent: d.document.pageContent || d.document.content || d.document.chunk,
                chatThreadId: d.document.chatThreadId,
                filename: d.document.filename || d.document.filepath,
                // Ensure other required fields are present if defined in interface
            },
        });
    });

    return withoutEmbedding;
};
