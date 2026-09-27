import { create } from "zustand";
import { persist } from "zustand/middleware";
import { QuickAction } from "@/lib/types";

interface QuickActionsState {
  quickActions: QuickAction[];
  isModalOpen: boolean;
  setIsModalOpen: (isOpen: boolean) => void;
  addQuickAction: (
    action: Omit<QuickAction, "id" | "createdAt" | "updatedAt">,
  ) => void;
  removeQuickAction: (id: string) => void;
  updateQuickAction: (id: string, action: Partial<QuickAction>) => void;
}

export const useQuickActionsStore = create<QuickActionsState>()(
  persist(
    (set) => ({
      quickActions: [],
      isModalOpen: false,
      setIsModalOpen: (isOpen) => set({ isModalOpen: isOpen }),
      addQuickAction: (action) =>
        set((state) => ({
          quickActions: [
            ...state.quickActions,
            {
              ...action,
              id: Math.random().toString(36).substring(7),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        })),
      removeQuickAction: (id) =>
        set((state) => ({
          quickActions: state.quickActions.filter((a) => a.id !== id),
        })),
      updateQuickAction: (id, updatedAction) =>
        set((state) => ({
          quickActions: state.quickActions.map((a) =>
            a.id === id
              ? { ...a, ...updatedAction, updatedAt: new Date().toISOString() }
              : a,
          ),
        })),
    }),
    {
      name: "quick-actions-storage",
    },
  ),
);
