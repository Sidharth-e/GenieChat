import { logger } from "@/lib/logger";
import type { Message } from "@/lib/types";
import { create } from "zustand";

export interface CanvasVersion {
  id: string; // unique ID for this code block instance
  code: string;
  language: string;
}

interface CanvasState {
  isOpen: boolean;
  versions: CanvasVersion[];
  activeIndex: number;
  openCanvas: (version: CanvasVersion, threadId?: string) => Promise<void>;
  fetchVersions: (threadId: string) => Promise<void>;
  closeCanvas: () => void;
  clearCanvas: () => void;
  nextVersion: () => void;
  prevVersion: () => void;
  setActiveIndex: (index: number) => void;
  setVersions: (versions: CanvasVersion[], activeIndex?: number) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  isOpen: false,
  versions: [],
  activeIndex: -1,

  openCanvas: async (version: CanvasVersion, threadId?: string) => {
    let { versions } = get();

    // If versions are empty and a threadId is provided, we might have a race condition where
    // the codeblock was clicked before the history was fetched. Let's fetch it first.
    if (versions.length === 0 && threadId) {
      await get().fetchVersions(threadId);
      versions = get().versions;
    }

    const normalizedNewCode = version.code.trim();

    // Check if this specific version ID or code content already exists
    const existingIndex = versions.findIndex(
      (v) => v.id === version.id || v.code.trim() === normalizedNewCode,
    );

    if (existingIndex !== -1) {
      // It exists, just switch to it and open
      set({ isOpen: true, activeIndex: existingIndex });
    } else {
      // It's a new version, add it to the end and switch to it
      set({
        isOpen: true,
        versions: [...versions, version],
        activeIndex: versions.length,
      });
    }
  },

  fetchVersions: async (threadId: string) => {
    if (!threadId) return;
    try {
      const response = await fetch(`/api/chat/threads/${threadId}`);
      if (!response.ok) return;

      const messages = await response.json();

      const extractedVersions: CanvasVersion[] = [];
      const seenHashes = new Set<string>();

      const addVersion = (codeContent: string) => {
        let hash = 0;
        for (let i = 0; i < codeContent.length; i++) {
          hash = (hash << 5) - hash + codeContent.charCodeAt(i);
          hash |= 0;
        }
        const versionId = `code_${Math.abs(hash).toString(16)}`;
        if (seenHashes.has(versionId)) return;
        seenHashes.add(versionId);
        extractedVersions.push({ id: versionId, code: codeContent, language: "react-canvas" });
      };

      const codeBlockRegex = /```(react-canvas)\n([\s\S]*?)```/g;

      messages.forEach((msg: Message) => {
        if (msg.role !== "assistant") return;

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            if (tc.name === "generate_canvas" && tc.result) {
              try {
                const parsed = JSON.parse(tc.result);
                if (parsed.react_canvas_code) {
                  addVersion(parsed.react_canvas_code.trim().replace(/\n$/, ""));
                }
              } catch {}
            }
          }
        }

        if (msg.content) {
          let match;
          while ((match = codeBlockRegex.exec(msg.content)) !== null) {
            addVersion(match[2].trim().replace(/\n$/, ""));
          }
        }
      });

      const store = get();
      if (extractedVersions.length > 0) {
        store.setVersions(
          extractedVersions,
          store.activeIndex === -1
            ? extractedVersions.length - 1
            : store.activeIndex,
        );
      }
    } catch (error) {
      logger.error("Failed to fetch chat history for canvas:", error);
    }
  },

  closeCanvas: () => set({ isOpen: false }),
  clearCanvas: () => set({ isOpen: false, versions: [], activeIndex: -1 }),

  nextVersion: () => {
    const { activeIndex, versions } = get();
    if (activeIndex < versions.length - 1) {
      set({ activeIndex: activeIndex + 1 });
    }
  },

  prevVersion: () => {
    const { activeIndex } = get();
    if (activeIndex > 0) {
      set({ activeIndex: activeIndex - 1 });
    }
  },

  setActiveIndex: (index: number) => {
    const { versions } = get();
    if (index >= 0 && index < versions.length) {
      set({ activeIndex: index });
    }
  },

  setVersions: (versions: CanvasVersion[], activeIndex?: number) => {
    set({
      versions,
      activeIndex:
        activeIndex !== undefined
          ? activeIndex
          : versions.length > 0
            ? versions.length - 1
            : -1,
    });
  },
}));
