"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AVAILABLE_MODELS } from "@/lib/langchain/model-config";

export interface ArenaStreamingState {
  content: string;
  isStreaming: boolean;
  latencyMs: number;
  tokens: { prompt: number; completion: number };
  error?: string;
  startTime: number;
}

interface ArenaState {
  // Mode
  isArenaMode: boolean;
  selectedModels: string[]; // 2-3 model IDs

  // Streaming state (not persisted)
  activeArenaResponses: Record<string, ArenaStreamingState>;
  isArenaStreaming: boolean;

  // Actions
  toggleArenaMode: () => void;
  setArenaMode: (enabled: boolean) => void;
  setSelectedModels: (models: string[]) => void;
  addModel: (modelId: string) => void;
  removeModel: (modelId: string) => void;

  // Streaming actions
  initArenaStream: (modelIds: string[]) => void;
  updateArenaStream: (
    modelId: string,
    update: Partial<ArenaStreamingState>,
  ) => void;
  appendArenaContent: (modelId: string, content: string) => void;
  finishArenaStream: (modelId: string, latencyMs: number) => void;
  clearArenaStreaming: () => void;
}

const MAX_ARENA_MODELS = 3;
const MIN_ARENA_MODELS = 2;

export const useArenaStore = create<ArenaState>()(
  persist(
    (set, get) => ({
      isArenaMode: false,
      selectedModels: [],
      activeArenaResponses: {},
      isArenaStreaming: false,

      toggleArenaMode: () => {
        const { isArenaMode, selectedModels } = get();
        if (!isArenaMode && selectedModels.length < MIN_ARENA_MODELS) {
          // Auto-select first 2 available models if none selected
          const defaults = AVAILABLE_MODELS.slice(0, MIN_ARENA_MODELS).map(
            (m) => m.id,
          );
          set({ isArenaMode: true, selectedModels: defaults });
        } else {
          set({ isArenaMode: !isArenaMode });
        }
      },

      setArenaMode: (enabled) => {
        if (enabled) {
          const { selectedModels } = get();
          if (selectedModels.length < MIN_ARENA_MODELS) {
            const defaults = AVAILABLE_MODELS.slice(0, MIN_ARENA_MODELS).map(
              (m) => m.id,
            );
            set({ isArenaMode: true, selectedModels: defaults });
            return;
          }
        }
        set({ isArenaMode: enabled });
      },

      setSelectedModels: (models) =>
        set({ selectedModels: models.slice(0, MAX_ARENA_MODELS) }),

      addModel: (modelId) => {
        const { selectedModels } = get();
        if (
          selectedModels.length >= MAX_ARENA_MODELS ||
          selectedModels.includes(modelId)
        )
          return;
        set({ selectedModels: [...selectedModels, modelId] });
      },

      removeModel: (modelId) => {
        const { selectedModels } = get();
        set({ selectedModels: selectedModels.filter((id) => id !== modelId) });
      },

      initArenaStream: (modelIds) => {
        const responses: Record<string, ArenaStreamingState> = {};
        const now = Date.now();
        for (const id of modelIds) {
          responses[id] = {
            content: "",
            isStreaming: true,
            latencyMs: 0,
            tokens: { prompt: 0, completion: 0 },
            startTime: now,
          };
        }
        set({ activeArenaResponses: responses, isArenaStreaming: true });
      },

      updateArenaStream: (modelId, update) => {
        const { activeArenaResponses } = get();
        const existing = activeArenaResponses[modelId];
        if (!existing) return;
        set({
          activeArenaResponses: {
            ...activeArenaResponses,
            [modelId]: { ...existing, ...update },
          },
        });
      },

      appendArenaContent: (modelId, content) => {
        const { activeArenaResponses } = get();
        const existing = activeArenaResponses[modelId];
        if (!existing) return;
        set({
          activeArenaResponses: {
            ...activeArenaResponses,
            [modelId]: {
              ...existing,
              content: existing.content + content,
            },
          },
        });
      },

      finishArenaStream: (modelId, latencyMs) => {
        const { activeArenaResponses } = get();
        const existing = activeArenaResponses[modelId];
        if (!existing) return;

        const updated = {
          ...activeArenaResponses,
          [modelId]: { ...existing, isStreaming: false, latencyMs },
        };

        // Check if all models are done
        const allDone = Object.values(updated).every((s) => !s.isStreaming);

        set({
          activeArenaResponses: updated,
          isArenaStreaming: !allDone,
        });
      },

      clearArenaStreaming: () =>
        set({ activeArenaResponses: {}, isArenaStreaming: false }),
    }),
    {
      name: "arena-settings",
      // Bumped to 2 when the provider set shrank to Google + Ollama: drop any
      // persisted model that no longer exists so the arena cannot be left with
      // a selection the API will reject.
      version: 2,
      migrate: (persistedState: unknown) => {
        const state = persistedState as {
          isArenaMode?: boolean;
          selectedModels?: string[];
        };
        return {
          isArenaMode: state.isArenaMode ?? false,
          selectedModels: (state.selectedModels ?? []).filter((id) =>
            AVAILABLE_MODELS.some((m) => m.id === id),
          ),
        };
      },
      partialize: (state) => ({
        isArenaMode: state.isArenaMode,
        selectedModels: state.selectedModels,
      }),
    },
  ),
);
