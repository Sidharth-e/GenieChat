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

/**
 * Whether the canvas accepts edits. Derived from the store rather than passed
 * down, because the canvas, a node's hover delete button and the node config
 * panel all need the same answer — a second copy would drift from this one.
 *
 * `workflow !== undefined` matters: the canvas calls `init` from an effect, so
 * before that runs the store has no workflow and nothing is editable yet.
 */
export function selectWorkflowEditable(state: WorkflowEditorState): boolean {
  return (
    state.hasEditAccess &&
    state.processIds.length === 0 &&
    state.workflow !== undefined &&
    !state.workflow.isPublished
  );
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
