"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ChatAttachment } from "@/lib/types";

interface Draft {
    attachments: ChatAttachment[];
    text?: string;
}

interface DraftState {
    drafts: Record<string, Draft>;
    addDraftAttachment: (contextKey: string, attachment: ChatAttachment) => void;
    removeDraftAttachment: (contextKey: string, attachmentId: string) => void;
    clearDraftAttachments: (contextKey: string) => void;
    setDraftText: (contextKey: string, text: string) => void;
    getDraft: (contextKey: string) => Draft;
    clearDraft: (contextKey: string) => void;
    clearAll: () => void;
}

export const useDraftStore = create<DraftState>()(
    persist(
        (set, get) => ({
    drafts: {},

    addDraftAttachment: (contextKey: string, attachment: ChatAttachment) => {
        set((state) => {
            const currentDraft = state.drafts[contextKey] || { attachments: [], text: "" };
            return {
                drafts: {
                    ...state.drafts,
                    [contextKey]: {
                        ...currentDraft,
                        attachments: [...currentDraft.attachments, attachment],
                    },
                },
            };
        });
    },

    removeDraftAttachment: (contextKey: string, attachmentId: string) => {
        set((state) => {
            const currentDraft = state.drafts[contextKey];
            if (!currentDraft) return state;
            return {
                drafts: {
                    ...state.drafts,
                    [contextKey]: {
                        ...currentDraft,
                        attachments: currentDraft.attachments.filter(a => a.id !== attachmentId),
                    },
                },
            };
        });
    },

    clearDraftAttachments: (contextKey: string) => {
        set((state) => {
            const currentDraft = state.drafts[contextKey];
            if (!currentDraft) return state;
            return {
                drafts: {
                    ...state.drafts,
                    [contextKey]: {
                        ...currentDraft,
                        attachments: [],
                    },
                },
            };
        });
    },

    setDraftText: (contextKey: string, text: string) => {
        set((state) => ({
            drafts: {
                ...state.drafts,
                [contextKey]: {
                    ...state.drafts[contextKey],
                    attachments: state.drafts[contextKey]?.attachments || [],
                    text,
                },
            },
        }));
    },

    getDraft: (contextKey: string) => {
        return get().drafts[contextKey] || { attachments: [], text: "" };
    },

    clearDraft: (contextKey: string) => {
        set((state) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [contextKey]: _removed, ...rest } = state.drafts;
            return { drafts: rest };
        });
    },

    clearAll: () => {
        set({ drafts: {} });
    },
        }),
        {
            name: "draft-inputs-storage",
        }
    )
);
