import { logger } from "@/lib/logger";
import {
    Thread,
    Message,
    MessageVersion,
    Prompt,
    ThreadType,
} from "./types";
import { generateId } from "./utils";
import { isDatabaseConfigured } from "./mongodb/client";
import { ChatHistoryStore } from "./mongodb/chat-history-store";
import { PromptStore } from "./mongodb/prompt-store";

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

function seedVersionsFromMessage(message: MessageCreateInput & { createdAt?: string }): Message["versions"] {
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
            activeVersionIndex: number
            ): Message {
            const clampedIndex = Math.min(
            Math.max(activeVersionIndex, 0),
            Math.max(versions.length - 1, 0)
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
            version: MessageVersionInput
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
            };    const nextVersions = [...versions, nextVersion];
    return applyActiveVersion(message, nextVersions, nextVersions.length - 1);
}

// Store interface that both implementations follow
export interface IStore {
    createThread(
        userId: string,
        model: string,
        agentId?: string,
        isMultiAgent?: boolean,
        threadType?: ThreadType,
        threadId?: string,
        userName?: string,
        userEmail?: string,
        options?: { isSwarm?: boolean; swarmAgentIds?: string[] },
    ): Promise<Thread>;
    getThread(threadId: string): Promise<Thread | null>;
    getThreads(userId: string, limit?: number): Promise<Thread[]>;
    updateThread(threadId: string, updates: Partial<Thread>): Promise<Thread | null>;
    deleteThread(threadId: string): Promise<boolean>;
    addMessage(threadId: string, message: MessageCreateInput): Promise<Message>;
    getMessage(threadId: string, messageId: string): Promise<Message | null>;
    appendMessageVersion(
        threadId: string,
        messageId: string,
        version: MessageVersionInput
    ): Promise<Message | null>;
    getMessages(threadId: string): Promise<Message[]>;
    createPrompt(prompt: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount">): Promise<Prompt>;
    getPrompts(userId: string): Promise<Prompt[]>;
    updatePrompt(promptId: string, updates: Partial<Prompt>): Promise<Prompt | null>;
    deletePrompt(promptId: string): Promise<boolean>;
    toggleShareThread(
        threadId: string,
        enable?: boolean,
        shareMode?: "public" | "specific",
        sharedWith?: { id: string; displayName: string; email: string }[]
    ): Promise<{ isShared: boolean; shareId: string | null; shareMode?: "public" | "specific"; sharedWith?: { id: string; displayName: string; email: string }[] } | null>;
    updateMessageActiveVersion(
        threadId: string,
        messageId: string,
        activeVersionIndex: number
    ): Promise<Message | null>;
}

/**
 * Composite store that delegates to specialized database stores
 */
class CompositeDatabaseStore implements IStore {
    private chatHistoryStore: ChatHistoryStore;
    private promptStore: PromptStore;

    constructor() {
        this.chatHistoryStore = new ChatHistoryStore();
        this.promptStore = new PromptStore();
    }

    createThread(
        userId: string,
        model: string,
        agentId?: string,
        isMultiAgent?: boolean,
        threadType?: ThreadType,
        threadId?: string,
        userName?: string,
        userEmail?: string,
        options?: { isSwarm?: boolean; swarmAgentIds?: string[] },
    ) {
        return this.chatHistoryStore.createThread(
            userId,
            model,
            agentId,
            isMultiAgent,
            threadType,
            threadId,
            userName,
            userEmail,
            options,
        );
    }
    getThread(threadId: string) {
        return this.chatHistoryStore.getThread(threadId);
    }
    getThreads(userId: string, limit?: number) {
        return this.chatHistoryStore.getThreads(userId, limit);
    }
    updateThread(threadId: string, updates: Partial<Thread>) {
        return this.chatHistoryStore.updateThread(threadId, updates);
    }
    deleteThread(threadId: string) {
        return this.chatHistoryStore.deleteThread(threadId);
    }
    addMessage(threadId: string, message: MessageCreateInput) {
        return this.chatHistoryStore.addMessage(threadId, message);
    }
    getMessage(threadId: string, messageId: string) {
        return this.chatHistoryStore.getMessage(threadId, messageId);
    }
    appendMessageVersion(
        threadId: string,
        messageId: string,
        version: MessageVersionInput
    ) {
        return this.chatHistoryStore.appendMessageVersion(
            threadId,
            messageId,
            version
        );
    }
    getMessages(threadId: string) {
        return this.chatHistoryStore.getMessages(threadId);
    }
    createPrompt(prompt: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount">) {
        return this.promptStore.createPrompt(prompt);
    }
    getPrompts(userId: string) {
        return this.promptStore.getPrompts(userId);
    }
    updatePrompt(promptId: string, updates: Partial<Prompt>) {
        return this.promptStore.updatePrompt(promptId, updates);
    }
    deletePrompt(promptId: string) {
        return this.promptStore.deletePrompt(promptId);
    }
    toggleShareThread(
        threadId: string,
        enable?: boolean,
        shareMode?: "public" | "specific",
        sharedWith?: { id: string; displayName: string; email: string }[]
    ) {
        return this.chatHistoryStore.toggleShareThread(threadId, enable, shareMode, sharedWith);
    }
    updateMessageActiveVersion(
        threadId: string,
        messageId: string,
        activeVersionIndex: number
    ) {
        return this.chatHistoryStore.updateMessageActiveVersion(threadId, messageId, activeVersionIndex);
    }
}

// In-memory storage for development (fallback when the database is not configured)
class InMemoryStore implements IStore {
    private threads: Map<string, Thread> = new Map();
    private messages: Map<string, Message[]> = new Map();
    private prompts: Map<string, Prompt> = new Map();

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
        const thread: Thread = {
            id: threadId || generateId(),
            userId,
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
        this.threads.set(thread.id, thread);
        this.messages.set(thread.id, []);
        return thread;
    }

    async getThread(threadId: string): Promise<Thread | null> {
        return this.threads.get(threadId) || null;
    }

    async getThreads(userId: string, limit?: number): Promise<Thread[]> {
        const threads = Array.from(this.threads.values())
            .filter((t) => t.userId === userId)
            .sort(
                (a, b) =>
                    new Date(b.lastMessageAt).getTime() -
                    new Date(a.lastMessageAt).getTime()
            );

        return typeof limit === "number" ? threads.slice(0, limit) : threads;
    }

    async updateThread(
        threadId: string,
        updates: Partial<Thread>
    ): Promise<Thread | null> {
        const thread = this.threads.get(threadId);
        if (!thread) return null;

        const updated = {
            ...thread,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        this.threads.set(threadId, updated);
        return updated;
    }

    async deleteThread(threadId: string): Promise<boolean> {
        this.messages.delete(threadId);
        return this.threads.delete(threadId);
    }

    // Message operations
    async addMessage(
        threadId: string,
        message: MessageCreateInput
    ): Promise<Message> {
        const now = new Date().toISOString();
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
        const rawActiveIndex =
            message.activeVersionIndex ?? versions.length - 1;
        const activeVersionIndex = Math.min(
            Math.max(rawActiveIndex, 0),
            versions.length - 1
        );
        const activeVersion = versions[activeVersionIndex];
        const thread = this.threads.get(threadId);
        const resolvedUserName =
            message.userName ?? thread?.userName ?? "";
        const resolvedUserEmail =
            message.userEmail ?? thread?.userEmail ?? "";

        const newMessage: Message = {
            ...message,
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
            id: generateId(),
            createdAt: now,
        };

        const threadMessages = this.messages.get(threadId) || [];
        threadMessages.push(newMessage);
        this.messages.set(threadId, threadMessages);

        // Update thread
        if (thread) {
            const imageCount = threadMessages.reduce((acc, msg) => acc + (msg.images?.length || 0), 0);
            const attachmentCount = threadMessages.reduce((acc, msg) => acc + (msg.documents?.length || 0), 0);

            thread.messageCount = threadMessages.length;
            thread.imageCount = imageCount;
            thread.attachmentCount = attachmentCount;
            thread.lastMessageAt = newMessage.createdAt;
            thread.updatedAt = newMessage.createdAt;
            this.threads.set(threadId, thread);
        }

        return newMessage;
    }

    async appendMessageVersion(
        threadId: string,
        messageId: string,
        version: MessageVersionInput
    ): Promise<Message | null> {
        const threadMessages = this.messages.get(threadId) || [];
        const messageIndex = threadMessages.findIndex((msg) => msg.id === messageId);
        if (messageIndex < 0) return null;

        const updatedMessage = appendVersionToMessage(
            threadMessages[messageIndex],
            version
        );
        threadMessages[messageIndex] = updatedMessage;
        this.messages.set(threadId, threadMessages);
        return updatedMessage;
    }

    async getMessage(threadId: string, messageId: string): Promise<Message | null> {
        const threadMessages = this.messages.get(threadId) || [];
        return threadMessages.find((msg) => msg.id === messageId) || null;
    }

    async updateMessageActiveVersion(
        threadId: string,
        messageId: string,
        activeVersionIndex: number
    ): Promise<Message | null> {
        const threadMessages = this.messages.get(threadId) || [];
        const messageIndex = threadMessages.findIndex((msg) => msg.id === messageId);
        if (messageIndex < 0) return null;

        const message = threadMessages[messageIndex];
        const versions = message.versions || [];
        
        if (activeVersionIndex < 0 || activeVersionIndex >= versions.length) {
            return null; // Invalid index
        }

        const updatedMessage = applyActiveVersion(message, versions, activeVersionIndex);
        threadMessages[messageIndex] = updatedMessage;
        this.messages.set(threadId, threadMessages);
        
        return updatedMessage;
    }

    async getMessages(threadId: string): Promise<Message[]> {
        return this.messages.get(threadId) || [];
    }

    // Prompt operations
    async createPrompt(
        prompt: Omit<Prompt, "id" | "createdAt" | "updatedAt" | "usageCount">
    ): Promise<Prompt> {
        const now = new Date().toISOString();
        const newPrompt: Prompt = {
            ...prompt,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
            usageCount: 0,
            isFavorite: false,
        };
        this.prompts.set(newPrompt.id, newPrompt);
        return newPrompt;
    }

    async getPrompts(userId: string): Promise<Prompt[]> {
        return Array.from(this.prompts.values())
            .filter((p) => p.userId === userId)
            .sort(
                (a, b) =>
                    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
    }

    async updatePrompt(
        promptId: string,
        updates: Partial<Prompt>
    ): Promise<Prompt | null> {
        const prompt = this.prompts.get(promptId);
        if (!prompt) return null;

        const updated = {
            ...prompt,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        this.prompts.set(promptId, updated);
        return updated;
    }

    async deletePrompt(promptId: string): Promise<boolean> {
        return this.prompts.delete(promptId);
    }

    async toggleShareThread(
        threadId: string,
        enable?: boolean,
        shareMode?: "public" | "specific",
        sharedWith?: { id: string; displayName: string; email: string }[]
    ): Promise<{ isShared: boolean; shareId: string | null; shareMode?: "public" | "specific"; sharedWith?: { id: string; displayName: string; email: string }[] } | null> {
        const thread = this.threads.get(threadId);
        if (!thread) return null;

        const newIsShared = enable !== undefined ? enable : !thread.isShared;
        const newShareId = newIsShared ? (thread.shareId || generateId()) : thread.shareId;
        const newShareMode = shareMode ?? thread.shareMode ?? "public";
        const newSharedWith = sharedWith ?? thread.sharedWith ?? [];

        thread.isShared = newIsShared;
        thread.shareId = newShareId;
        thread.shareMode = newShareMode;
        thread.sharedWith = newSharedWith;
        this.threads.set(threadId, thread);

        return {
            isShared: newIsShared,
            shareId: newShareId || null,
            shareMode: newShareMode,
            sharedWith: newSharedWith,
        };
    }
}

// Create the appropriate store based on environment configuration
function createStore(): IStore {
    if (isDatabaseConfigured()) {
        logger.debug("Using database store with specialized split stores");
        return new CompositeDatabaseStore();
    } else {
        logger.debug("Database not configured, using in-memory store");
        return new InMemoryStore();
    }
}

// Singleton instance
export const store: IStore = createStore();


