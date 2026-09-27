"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PromptsState {
    selectedPromptId: string | null;
    setSelectedPrompt: (id: string | null) => void;
}

/**
 * Client-side state for prompts.
 * Server state (prompts list, loading, errors) is managed by React Query hooks.
 */
export const usePromptsStore = create<PromptsState>()(
    persist(
        (set) => ({
            selectedPromptId: null,

            setSelectedPrompt: (id) => {
                set({ selectedPromptId: id });
            },
        }),
        {
            name: "prompts-store",
        }
    )
);
