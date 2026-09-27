"use client";

import { create } from "zustand";
import type { RichWorkflow } from "@/lib/types";

export interface WorkflowEditorState {
  workflow?: RichWorkflow;
  processIds: string[];
  hasEditAccess: boolean;
}

export interface WorkflowEditorActions {
  init: (workflow?: RichWorkflow, hasEditAccess?: boolean) => void;
  addProcess: () => () => void;
}

export const useWorkflowEditorStore = create<
  WorkflowEditorState & WorkflowEditorActions
>((set) => ({
  workflow: undefined,
  processIds: [],
  hasEditAccess: false,

  init: (workflow, hasEditAccess = false) =>
    set({ workflow, hasEditAccess, processIds: [] }),

  addProcess: () => {
    const processId = crypto.randomUUID();
    set((state) => ({
      processIds: [...state.processIds, processId],
    }));
    return () => {
      set((state) => ({
        processIds: state.processIds.filter((id) => id !== processId),
      }));
    };
  },
}));
