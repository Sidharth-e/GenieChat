import "server-only";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { ChatCitationStore } from "@/lib/mongodb/document-store";
import { generateId } from "@/lib/utils";
import type { ServerActionResponse } from "@/lib/types";
import { CHAT_CITATION_ATTRIBUTE } from "@/constants/knowledge";
import type { ChatCitationModel, KnowledgeHit } from "./types";

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
    models: KnowledgeHit[],
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
            // The Azure hit carried the thread id in its `document.metadata`;
            // `KnowledgeHit` does not, and a hit cannot know which thread asked
            // for it. Callers that need a citation tied to its thread must pass
            // it in rather than reading it off the hit.
            chatThreadId: "",
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
