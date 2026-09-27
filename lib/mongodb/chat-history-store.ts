import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import { getServerSession } from "next-auth";
import { getThreadCollection, getHistoryCollection } from "./client";
import { authOptions } from "@/lib/auth/config";
import { Thread, Message, MessageVersion, ThreadType, ArenaMetadata } from "../types";
import { generateId } from "../utils";
import {
  WithMongoId,
  ThreadDocument,
  MessageDocument,
  hydrateDocument,
} from "./common";

type MessageCreateInput = Omit<
  Message,
  | "id"
  | "createdAt"
  | "versions"
  | "activeVersionIndex"
  | "userName"
  | "userEmail"
> & {
  userName?: string;
  userEmail?: string;
  versions?: Message["versions"];
  activeVersionIndex?: number;
  versionId?: string;
  pairedUserVersionId?: string;
  pairedAssistantVersionId?: string;
};

type MessageVersionInput = Omit<MessageVersion, "versionId" | "createdAt"> & {
  versionId?: string;
  createdAt?: string;
};

type SharedThreadAccessResult = {
  thread: Thread | null;
  accessDenied: boolean;
};

function seedVersionsFromMessage(message: Message & Partial<Pick<MessageVersion, 'versionId' | 'pairedUserVersionId' | 'pairedAssistantVersionId'>>): Message["versions"] {
  if (message.versions?.length) {
    return message.versions;
  }

  return [
    {
      versionId: message.versionId || generateId(),
      content: message.content,
      model: message.model,
      agentId: message.agentId,
      agentName: message.agentName,
      toolCalls: message.toolCalls,
      documents: message.documents,
      images: message.images,
      tokens: message.tokens,
      citations: message.citations,
      researchReport: message.researchReport,
      pairedUserVersionId: message.pairedUserVersionId || message.versions?.[0]?.pairedUserVersionId,
      pairedAssistantVersionId: message.pairedAssistantVersionId || message.versions?.[0]?.pairedAssistantVersionId,
      createdAt: message.createdAt || new Date().toISOString(),
    },
  ];
}

  function applyActiveVersion(
  message: Message,
  versions: Message["versions"],
  activeVersionIndex: number,
  ): Message {
  const clampedIndex = Math.min(
    Math.max(activeVersionIndex, 0),
    Math.max(versions.length - 1, 0),
  );
  const activeVersion = versions[clampedIndex];

  return {
    ...message,
    content: activeVersion.content,
    model: activeVersion.model,
    agentId: activeVersion.agentId,
    agentName: activeVersion.agentName,
    toolCalls: activeVersion.toolCalls,
    documents: activeVersion.documents,
    images: activeVersion.images,
    tokens: activeVersion.tokens,
    citations: activeVersion.citations,
    researchReport: activeVersion.researchReport,
    versions,
    activeVersionIndex: clampedIndex,
  };
  }

  function appendVersionToMessage(
  message: Message,
  version: MessageVersionInput,
  ): Message {
  const versions = seedVersionsFromMessage(message);
  const now = new Date().toISOString();
  const nextVersion: MessageVersion = {
    versionId: version.versionId || generateId(),
    content: version.content,
    model: version.model,
    agentId: version.agentId,
    agentName: version.agentName,
    toolCalls: version.toolCalls,
    documents: version.documents,
    images: version.images,
    tokens: version.tokens,
    citations: version.citations,
    researchReport: version.researchReport,
    pairedUserVersionId: version.pairedUserVersionId,
    pairedAssistantVersionId: version.pairedAssistantVersionId,
    createdAt: version.createdAt || now,
  };  const nextVersions = [...versions, nextVersion];
  return applyActiveVersion(message, nextVersions, nextVersions.length - 1);
}

export class ChatHistoryStore {
  private threadCollection: Collection<WithMongoId<ThreadDocument>>;
  private historyCollection: Collection<WithMongoId<MessageDocument>>;

  constructor() {
    this.threadCollection = getThreadCollection();
    this.historyCollection = getHistoryCollection();
  }

  private hydrateMessage(doc: WithMongoId<MessageDocument>): Message {
    const message = hydrateDocument(doc) as Message;
    const versions = seedVersionsFromMessage(message);
    if (message.agentId || message.agentName) {
      for (const v of versions) {
        if (!v.agentId && message.agentId) v.agentId = message.agentId;
        if (!v.agentName && message.agentName) v.agentName = message.agentName;
      }
    }
    const activeVersionIndex =
      typeof message.activeVersionIndex === "number"
        ? message.activeVersionIndex
        : versions.length - 1;

    return applyActiveVersion(message, versions, activeVersionIndex);
  }

  private async getThreadDocument(
    threadId: string,
  ): Promise<WithMongoId<ThreadDocument> | null> {
    try {
      return await this.threadCollection.findOne({
        _id: threadId,
        type: "thread",
      });
    } catch (error) {
      logger.error("Error getting thread:", error);
      return null;
    }
  }

  private async replaceThreadDocument(
    existingThread: WithMongoId<ThreadDocument>,
    updates: Partial<Thread>,
  ): Promise<Thread> {
    const updated: WithMongoId<ThreadDocument> = {
      ...existingThread,
      ...updates,
      // Re-asserted after the caller's spread, so a body cannot re-own the
      // thread or move it in a listing.
      userId: existingThread.userId,
      type: "thread",
      createdAt: existingThread.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // The filter comes from the read, not the merge.
    const { _id, ...rest } = updated;
    const result = await this.threadCollection.replaceOne({ _id: existingThread._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Thread not found: ${_id}`);
    }

    return hydrateDocument(updated);
  }

  private async queryThreadMessages(
    threadId: string,
  ): Promise<WithMongoId<MessageDocument>[]> {
    return this.historyCollection
      .find({ threadId, type: "message" })
      .sort({ createdAt: 1 })
      .toArray();
  }

  private async getMessageDocument(
    threadId: string,
    messageId: string,
  ): Promise<WithMongoId<MessageDocument> | null> {
    try {
      return await this.historyCollection.findOne({
        _id: messageId,
        threadId,
        type: "message",
      });
    } catch (error) {
      logger.error("Error getting message document:", {
        threadId,
        messageId,
        error,
      });
      return null;
    }
  }

  private async replaceMessageDocument(
    updatedMessage: WithMongoId<MessageDocument>,
  ): Promise<void> {
    // Written as `{ _id: updatedMessage._id }` so the sweep reads uniformly --
    // NOT for protection. It is expression-identical to the destructured `_id`
    // below, so an `_id` spread into `updatedMessage` would still become the
    // filter here. What keeps this site safe is its callers, each of which
    // re-asserts `_id` from its own read; a future caller that spread a request
    // body over the message would reintroduce the hole at this line.
    const { _id, ...rest } = updatedMessage;
    const result = await this.historyCollection.replaceOne({ _id: updatedMessage._id }, rest);
    if (result.matchedCount === 0) {
      throw new Error(`Message not found: ${_id}`);
    }
  }

  // Thread operations
  async createThread(
    userId: string,
    model: string,
    agentId?: string,
    isMultiAgent?: boolean,
    threadType: ThreadType = "chat",
    threadId?: string,
    userName: string = "",
    userEmail: string = "",
    options?: { isSwarm?: boolean; swarmAgentIds?: string[] },
  ): Promise<Thread> {
    const now = new Date().toISOString();
    const id = threadId || generateId();
    const thread: WithMongoId<ThreadDocument> = {
      id,
      _id: id,
      type: "thread",
      userId, // Semantic field
      userName,
      userEmail,
      title: "New Chat",
      isBookmarked: false,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
      model,
      isShared: false,

      agentId,
      isMultiAgent,
      isSwarm: options?.isSwarm,
      swarmAgentIds: options?.swarmAgentIds,
      threadType,
    };

    await this.threadCollection.insertOne(thread);
    return hydrateDocument(thread);
  }

  // `userId` is kept only for signature compatibility with the Cosmos store:
  // `_id` is a globally unique uuidv7, so the read no longer needs it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getThread(threadId: string, userId?: string): Promise<Thread | null> {
    const thread = await this.getThreadDocument(threadId);
    return thread ? hydrateDocument(thread) : null;
  }

  async getThreads(userId: string, limit?: number): Promise<Thread[]> {
    const hasLimit =
      typeof limit === "number" && Number.isFinite(limit) && limit > 0;

    const projection = {
      _id: 1, title: 1, lastMessageAt: 1, agentId: 1, isMultiAgent: 1, isSwarm: 1,
      isBookmarked: 1, isShared: 1, shareId: 1, shareMode: 1, sharedWith: 1,
      userId: 1, type: 1, createdAt: 1,
    } as const;

    const cursor = this.threadCollection
      .find({ userId, type: "thread" }, { projection })
      .sort({ lastMessageAt: -1 });

    const docs = await (hasLimit ? cursor.limit(limit!) : cursor).toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async updateThread(
    threadId: string,
    updates: Partial<Thread>,
  ): Promise<Thread | null> {
    const existingThread = await this.getThreadDocument(threadId);
    if (!existingThread) return null;

    return this.replaceThreadDocument(existingThread, updates);
  }

  async deleteThread(threadId: string): Promise<boolean> {
    try {
      const thread = await this.getThread(threadId);
      if (!thread) return false;

      // Delete the thread
      await this.threadCollection.deleteOne({ _id: threadId });

      // Delete all messages in the thread from the history collection
      await this.historyCollection.deleteMany({ threadId, type: "message" });

      return true;
    } catch (error) {
      logger.error("Error deleting thread:", error);
      return false;
    }
  }

  // Message operations in historyCollection
  async getMessages(threadId: string): Promise<Message[]> {
    try {
      const rawMessages = await this.queryThreadMessages(threadId);

      return rawMessages.map((doc) => this.hydrateMessage(doc));
    } catch (error) {
      logger.error("Error querying messages:", error);
      return [];
    }
  }

  async addMessage(
    threadId: string,
    message: MessageCreateInput,
  ): Promise<Message> {
    const now = new Date().toISOString();
    const thread = await this.getThreadDocument(threadId);
    const resolvedUserName = message.userName ?? thread?.userName ?? "";
    const resolvedUserEmail = message.userEmail ?? thread?.userEmail ?? "";
    const versions =
      message.versions?.length
        ? message.versions
        : [
            {
              versionId: message.versionId || generateId(),
              content: message.content,
              model: message.model,
              agentId: message.agentId,
              agentName: message.agentName,
              toolCalls: message.toolCalls,
              documents: message.documents,
              images: message.images,
              tokens: message.tokens,
              citations: message.citations,
              researchReport: message.researchReport,
              pairedUserVersionId: message.pairedUserVersionId,
              pairedAssistantVersionId: message.pairedAssistantVersionId,
              createdAt: now,
            },
          ];
    const rawActiveIndex = message.activeVersionIndex ?? versions.length - 1;
    const activeVersionIndex = Math.min(
      Math.max(rawActiveIndex, 0),
      versions.length - 1,
    );
    const activeVersion = versions[activeVersionIndex];

    const id = generateId();
    const newMessage: WithMongoId<MessageDocument> = {
      ...(message as Message),
      userName: resolvedUserName,
      userEmail: resolvedUserEmail,
      content: activeVersion.content,
      model: activeVersion.model,
      toolCalls: activeVersion.toolCalls,
      documents: activeVersion.documents,
      images: activeVersion.images,
      tokens: activeVersion.tokens,
      citations: activeVersion.citations,
      researchReport: activeVersion.researchReport,
      versions,
      activeVersionIndex,
      id,
      _id: id,
      type: "message",
      threadId,
      createdAt: now,
    };

    await this.historyCollection.insertOne(newMessage);

    if (thread) {
      await this.replaceThreadDocument(thread, {
        messageCount: (thread.messageCount || 0) + 1,
        imageCount: (thread.imageCount || 0) + (newMessage.images?.length || 0),
        attachmentCount:
          (thread.attachmentCount || 0) + (newMessage.documents?.length || 0),
        lastMessageAt: newMessage.createdAt,
      });
    }

    return hydrateDocument(newMessage);
  }

  async getMessage(threadId: string, messageId: string): Promise<Message | null> {
    try {
      const message = await this.getMessageDocument(threadId, messageId);
      return message ? this.hydrateMessage(message) : null;
    } catch (error) {
      logger.error("Error getting message:", { threadId, messageId, error });
      return null;
    }
  }

  async appendMessageVersion(
    threadId: string,
    messageId: string,
    version: MessageVersionInput,
  ): Promise<Message | null> {
    try {
      const rawMessage = await this.getMessageDocument(threadId, messageId);
      if (!rawMessage) {
        return null;
      }

      const existingMessage = hydrateDocument(rawMessage) as Message;
      const updatedMessage = appendVersionToMessage(existingMessage, version);

      const updatedDoc: WithMongoId<MessageDocument> = {
        ...(updatedMessage as MessageDocument),
        _id: rawMessage._id,
        type: "message",
      };

      await this.replaceMessageDocument(updatedDoc);

      return updatedMessage;
    } catch (error) {
      logger.error("Error appending message version:", {
        messageId,
        threadId,
        error,
      });
      return null;
    }
  }

  async updateMessageActiveVersion(
    threadId: string,
    messageId: string,
    activeVersionIndex: number,
  ): Promise<Message | null> {
    try {
      const rawMessage = await this.getMessageDocument(threadId, messageId);
      if (!rawMessage) {
        return null;
      }

      const versions = seedVersionsFromMessage(rawMessage);

      if (activeVersionIndex < 0 || activeVersionIndex >= versions.length) {
        return null;
      }

      const existingMessage = hydrateDocument(rawMessage) as Message;
      const updatedMessage = applyActiveVersion(existingMessage, versions, activeVersionIndex);

      const updatedDoc: WithMongoId<MessageDocument> = {
        ...(updatedMessage as MessageDocument),
        _id: rawMessage._id,
        type: "message",
      };

      await this.replaceMessageDocument(updatedDoc);

      return updatedMessage;
    } catch (error) {
      logger.error("Error updating message active version:", {
        messageId,
        threadId,
        error,
      });
      return null;
    }
  }

  // Get thread by shareId (for public share pages)
  async getThreadByShareId(shareId: string): Promise<Thread | null> {
    try {
      logger.info("Looking for thread with shareId:", shareId);

      const thread = await this.threadCollection.findOne({
        shareId,
        isShared: true,
        type: "thread",
      });

      logger.info("Found threads:", {
        count: thread ? 1 : 0,
        threads: thread
          ? [{ id: thread.id, shareId: thread.shareId, isShared: thread.isShared }]
          : [],
      });

      return thread ? hydrateDocument(thread) : null;
    } catch (error) {
      logger.error("Error getting thread by shareId:", error);
      return null;
    }
  }

  async getThreadByShareIdWithAccess(
    shareId: string,
  ): Promise<SharedThreadAccessResult> {
    const thread = await this.getThreadByShareId(shareId);

    if (!thread) {
      return { thread: null, accessDenied: false };
    }

    if (thread.shareMode !== "specific") {
      return { thread, accessDenied: false };
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { thread, accessDenied: true };
    }

    if (thread.userId === session.user.id) {
      return { thread, accessDenied: false };
    }

    const userEmail = session.user.email.toLowerCase();
    const hasUserAccess =
      thread.sharedWith?.some(
        (user) => user.email.toLowerCase() === userEmail,
      ) ?? false;

    return { thread, accessDenied: !hasUserAccess };
  }

  // Toggle share status for a thread (or set explicitly with enable parameter)
  async toggleShareThread(
    threadId: string,
    enable?: boolean,
    shareMode?: "public" | "specific",
    sharedWith?: { id: string; displayName: string; email: string }[],
  ): Promise<{
    isShared: boolean;
    shareId: string | null;
    shareMode?: "public" | "specific";
    sharedWith?: { id: string; displayName: string; email: string }[];
  } | null> {
    const thread = await this.getThread(threadId);
    if (!thread) return null;

    const newIsShared = enable !== undefined ? enable : !thread.isShared;
    const newShareId = newIsShared
      ? thread.shareId || generateId()
      : thread.shareId;
    const newShareMode = shareMode ?? thread.shareMode ?? "public";
    const newSharedWith = sharedWith ?? thread.sharedWith ?? [];

    logger.info("Toggle share:", {
      threadId,
      oldIsShared: thread.isShared,
      newIsShared,
      shareMode: newShareMode,
    });

    await this.updateThread(threadId, {
      isShared: newIsShared,
      shareId: newShareId,
      shareMode: newShareMode,
      sharedWith: newSharedWith,
    });

    const updatedThread = await this.getThread(threadId);
    logger.info("Updated thread:", {
      isShared: updatedThread?.isShared,
      shareId: updatedThread?.shareId,
      shareMode: updatedThread?.shareMode,
    });

    return {
      isShared: newIsShared,
      shareId: newShareId || null,
      shareMode: newShareMode,
      sharedWith: newSharedWith,
    };
  }

  // Update message feedback (like/dislike)
  async updateMessageFeedback(
    threadId: string,
    messageId: string,
    versionId: string,
    feedback: "like" | "dislike",
  ): Promise<boolean> {
    try {
      const message = await this.getMessageDocument(threadId, messageId);
      if (!message) {
        logger.error("Message not found:", messageId);
        return false;
      }

      // Update the specific version with feedback
      let updatedVersions = message.versions;
      if (updatedVersions) {
        updatedVersions = updatedVersions.map((v: MessageVersion) =>
          v.versionId === versionId ? { ...v, feedback } : v
        );
      }

      // Update the message with feedback
      const updated: WithMongoId<MessageDocument> = {
        ...message,
        _id: message._id,
        feedback, // Legacy fallback
        versions: updatedVersions,
      };

      await this.replaceMessageDocument(updated);

      return true;
    } catch (error) {
      logger.error("Error updating message feedback:", error);
      return false;
    }
  }

  async updateMessageArenaVote(
    threadId: string,
    messageId: string,
    arenaMetadata: ArenaMetadata,
    contentUpdate: Partial<Message>,
  ): Promise<boolean> {
    try {
      const message = await this.getMessageDocument(threadId, messageId);
      if (!message) {
        logger.error("Arena vote: message not found:", messageId);
        return false;
      }

      // Build the updated versions if winner was selected
      let updatedVersions = message.versions;
      if (contentUpdate.content && updatedVersions?.length > 0) {
        updatedVersions = [
          {
            ...updatedVersions[0],
            content: contentUpdate.content,
            model: contentUpdate.model || updatedVersions[0].model,
            tokens: contentUpdate.tokens ?? updatedVersions[0].tokens,
          },
          ...updatedVersions.slice(1),
        ];
      }

      const updated: WithMongoId<MessageDocument> = {
        ...message,
        ...contentUpdate,
        _id: message._id,
        arenaMetadata,
        versions: updatedVersions,
      };

      await this.replaceMessageDocument(updated);
      return true;
    } catch (error) {
      logger.error("Error updating arena vote:", error);
      return false;
    }
  }
}
