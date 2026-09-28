import "server-only";
import { CHAT_DOCUMENT_ATTRIBUTE } from "@/constants/knowledge";
import { RAG_MAX_UPLOAD_DOCUMENT_SIZE } from "@/constants/config";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { convertDocument } from "@/lib/docling";
import { logger } from "@/lib/logger";
import { ChatDocumentStore } from "@/lib/mongodb/document-store";
import type { ServerActionResponse } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { chunkDocumentWithOverlap } from "./chunking";
import { deleteChunksForSource, indexChunks } from "./index";
import type { ChatDocumentModel } from "./types";

export type CrackDocumentResponse = {
  documents: string[];
  totalPages: number;
};

export const ReadDocument = async (
  formData: FormData
): Promise<ServerActionResponse<string>> => {
  try {
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
      errors: fileResponse.errors || [{ message: "Error loading file" }],
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
    // Optional: a caller that already tracks this upload under its own id passes
    // it here, so the chunks' `source_id` is an id the caller can delete by.
    const documentId = (formData.get("documentId") as string | null) ?? undefined;
    const sessionUser = await getSessionUser();

    if (fileResponse.status === "OK") {
      const content = fileResponse.response.documents.join("\n");
      const splitDocuments = chunkDocumentWithOverlap(content);

      // Index the documents if chatThreadId or agentId is present (implies context awareness)
      if ((chatThreadId || agentId) && sessionUser) {
        logger.info(`[CrackDocument] Indexing for User: ${sessionUser.id}, Agent: ${agentId}, Thread: ${chatThreadId}`);

        // The metadata row is written first because its id is the chunks'
        // `source_id`: the chunks are addressed by the document they came from,
        // so the id has to exist before they are indexed.
        logger.info("[CrackDocument] Calling CreateChatDocument...");
        const created = await CreateChatDocument(
          fileResponse.response.filename,
          chatThreadId || "",
          content,
          0,
          fileResponse.response.totalPages,
          splitDocuments.length,
          Date.now(),
          agentId,
          documentId
        );

        if (created.status !== "OK") {
          return {
            status: "ERROR",
            errors: created.errors || [{ message: "Failed to save chat document" }],
          };
        }

        const ownerType = agentId ? "agent" : "chat";
        const ownerId = agentId ?? chatThreadId!;

        logger.info(`[CrackDocument] About to index ${splitDocuments.length} documents`);
        const indexed = await indexChunks({
          ownerType,
          ownerId,
          userId: sessionUser.id,
          sourceId: created.response.id,
          title: fileResponse.response.filename,
          contents: splitDocuments,
        });
        logger.info(`[CrackDocument] indexChunks result: ${indexed} chunks`);
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

      // The document's searchable chunks are a separate store now, so deleting
      // the document is not enough. Scoped by `source_id` rather than
      // `owner_id` because a chat owner (the thread) holds chunks from several
      // documents.
      //
      // The owner tuple is the one `CrackDocument` indexed under, read from the
      // document itself: an agent upload carries an `agentId` and no thread, so
      // a hardcoded chat owner would find nothing to delete and leave the
      // chunks orphaned.
      const ownerType = chatDocument.response.agentId ? "agent" : "chat";
      const ownerId = chatDocument.response.agentId ?? chatThreadID;

      try {
        await deleteChunksForSource(ownerType, ownerId, documentID);
      } catch (error) {
        logger.error(
          { err: error, chatThreadId: chatThreadID, documentId: documentID },
          "Deleted chat document but failed to delete its knowledge chunks; they are now orphaned",
        );
        throw error;
      }

      return {
        status: "OK",
        response: true,
      };
    }

    // Propagated rather than flattened to ERROR, because the two mean different
    // things to the caller: a missing row says there was nothing to clear, while
    // ERROR says the clear failed. The agent file delete treats the first as the
    // success it is (`decideAgentDocumentDelete`); turning it into an ERROR here
    // is what made a file that was stored but never indexed impossible to remove.
    if (chatDocument.status === "NOT_FOUND") {
      return {
        status: "NOT_FOUND",
        errors: [
          {
            message: `Chat document not found: ${documentID}`,
          },
        ],
      };
    }

    return {
      status: "ERROR",
      errors: chatDocument.errors,
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
  /**
   * The id to store under, when the caller already generated one. An agent file
   * upload generates its own id for the `AgentDocument` it tracks, and the
   * delete path addresses this document's chunks by that same id — so the two
   * have to be one value, and only the caller can supply it.
   */
  documentId?: string,
): Promise<ServerActionResponse<ChatDocumentModel>> => {
  try {
    const user = await getSessionUser();
    if (!user) throw new Error("User not found");

    const modelToSave: ChatDocumentModel = {
      chatThreadId: chatThreadID,
      id: documentId ?? generateId(),
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
