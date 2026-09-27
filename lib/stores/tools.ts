"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ToolsState {
    selectedToolId: string | null;
    setSelectedTool: (id: string | null) => void;
}

/**
 * Client-side state for tools.
 * Server state (tools list, loading, errors) is managed by React Query hooks.
 */
export const useToolsStore = create<ToolsState>()(
    persist(
        (set) => ({
            selectedToolId: null,

            setSelectedTool: (id) => {
                set({ selectedToolId: id });
            },
        }),
        {
            name: "tools-store",
        }
    )
);
