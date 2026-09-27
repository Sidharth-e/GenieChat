"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AgentsState {
    activeAgentId: string | null;
    setActiveAgent: (id: string | null) => void;
}

/**
 * Client-side state for agents.
 * Server state (agents list, loading, errors) is managed by React Query hooks.
 */
export const useAgentsStore = create<AgentsState>()(
    persist(
        (set) => ({
            activeAgentId: null,

            setActiveAgent: (id) => {
                set({ activeAgentId: id });
            },
        }),
        {
            name: "agents-store",
        }
    )
);
