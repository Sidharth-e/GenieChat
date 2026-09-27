"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
} from "@/lib/langchain/model-config";

const DEFAULT_MODEL = DEFAULT_MODEL_ID;

interface ChatSettingsState {
  selectedModel: string;
  selectedAgentId: string | null;
  memoryEnabled: boolean;
  setSelectedModel: (model: string) => void;
  setSelectedAgentId: (agentId: string | null) => void;
  setMemoryEnabled: (enabled: boolean) => void;
}

export const useChatSettings = create<ChatSettingsState>()(
  persist(
    (set) => ({
      selectedModel: DEFAULT_MODEL,
      selectedAgentId: null,
      memoryEnabled: true,
      setSelectedModel: (model: string) =>
        set({ selectedModel: model, selectedAgentId: null }),
      setSelectedAgentId: (agentId: string | null) =>
        set({ selectedAgentId: agentId }),
      setMemoryEnabled: (enabled: boolean) => set({ memoryEnabled: enabled }),
    }),
    {
      name: "chat-settings",
      // Bumped to 3 when the provider set shrank to Google + Ollama, so that
      // sessions persisted with a now-removed model (e.g. gpt-5.4) re-run the
      // migration below and fall back to a model that still exists.
      version: 3,
      migrate: (persistedState: unknown) => {
        const state = persistedState as Partial<ChatSettingsState>;
        const isValidModel = AVAILABLE_MODELS.some(
          (m) => m.id === state.selectedModel,
        );
        return {
          ...state,
          selectedModel: isValidModel ? state.selectedModel! : DEFAULT_MODEL,
          memoryEnabled: state.memoryEnabled ?? true,
        } as ChatSettingsState;
      },
    },
  ),
);
