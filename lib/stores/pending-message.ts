"use client";

import { create } from "zustand";
import { ChatAttachment } from "@/lib/types";
import { DeepResearchDepth } from "@/lib/deep-research";

export const NEW_CHAT_PENDING_KEY = "__new_chat__";

export interface PendingMessageData {
    message: string;
    attachments: ChatAttachment[];
    forceWebSearch?: boolean;
    isResearch?: boolean;
    deepResearchDepth?: DeepResearchDepth;
    isArena?: boolean;
    arenaModels?: string[];
    swarmAgentIds?: string[];
}

interface PendingMessageOptions {
    isResearch?: boolean;
    deepResearchDepth?: DeepResearchDepth;
    isArena?: boolean;
    arenaModels?: string[];
    swarmAgentIds?: string[];
}

interface PendingMessageState {
    pendingMessages: Record<string, PendingMessageData>;
    setPendingMessage: (
        threadId: string,
        message: string,
        attachments?: ChatAttachment[],
        forceWebSearch?: boolean,
        options?: PendingMessageOptions
    ) => void;
    getPendingMessage: (threadId: string) => PendingMessageData | null;
    clearPendingMessage: (threadId: string) => void;
}

export const usePendingMessageStore = create<PendingMessageState>()((set, get) => ({
    pendingMessages: {},

    setPendingMessage: (
        threadId: string,
        message: string,
        attachments: ChatAttachment[] = [],
        forceWebSearch?: boolean,
        options?: PendingMessageOptions
    ) => {
        set((state) => ({
            pendingMessages: {
                ...state.pendingMessages,
                [threadId]: {
                    message,
                    attachments,
                    forceWebSearch,
                    isResearch: options?.isResearch,
                    deepResearchDepth: options?.deepResearchDepth,
                    isArena: options?.isArena,
                    arenaModels: options?.arenaModels,
                    swarmAgentIds: options?.swarmAgentIds,
                },
            },
        }));
    },

    getPendingMessage: (threadId: string) => {
        const data = get().pendingMessages[threadId];
        return data || null;
    },

    clearPendingMessage: (threadId: string) => {
        set((state) => {
            const rest = { ...state.pendingMessages };
            delete rest[threadId];
            return { pendingMessages: rest };
        });
    },
}));
