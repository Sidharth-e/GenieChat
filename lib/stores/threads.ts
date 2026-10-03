"use client";

import { logger } from "@/lib/logger";
import { create } from "zustand";
import { Thread } from "@/lib/types";

interface ThreadsState {
  threads: Thread[];
  isLoading: boolean;
  error: string | null;
  fetchThreads: () => Promise<void>;
  addThread: (thread: Thread) => void;
  updateThreadTitle: (threadId: string, title: string) => void;
  deleteThread: (threadId: string) => Promise<boolean>;
  toggleBookmark: (threadId: string) => Promise<boolean>;
  renameThread: (threadId: string, title: string) => Promise<boolean>;
}

export const useThreadsStore = create<ThreadsState>()((set) => ({
  threads: [],
  isLoading: true,
  error: null,

  fetchThreads: async () => {
    try {
      set({ isLoading: true });
      const res = await fetch("/api/chat/threads");
      if (res.ok) {
        const data = await res.json();
        set({ threads: data, error: null });
      }
    } catch (e) {
      set({ error: "Failed to load threads" });
      logger.error("Failed to load threads:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  addThread: (thread: Thread) => {
    set((state) => ({
      threads: [thread, ...state.threads],
    }));
  },

  updateThreadTitle: (threadId: string, title: string) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, title } : t,
      ),
    }));
  },

  deleteThread: async (threadId: string) => {
    try {
      const res = await fetch("/api/chat/threads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, action: "delete" }),
      });

      if (res.ok) {
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== threadId),
        }));
        return true;
      }
    } catch (e) {
      logger.error("Failed to delete thread:", e);
    }
    return false;
  },

  toggleBookmark: async (threadId: string) => {
    try {
      const res = await fetch("/api/chat/threads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, action: "bookmark" }),
      });

      if (res.ok) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId ? { ...t, isBookmarked: !t.isBookmarked } : t,
          ),
        }));
        return true;
      }
    } catch (e) {
      logger.error("Failed to toggle bookmark:", e);
    }
    return false;
  },

  renameThread: async (threadId: string, title: string) => {
    try {
      const res = await fetch("/api/chat/threads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, action: "rename", data: { title } }),
      });

      if (res.ok) {
        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId ? { ...t, title } : t,
          ),
        }));
        return true;
      }
    } catch (e) {
      logger.error("Failed to rename thread:", e);
    }
    return false;
  },
}));
