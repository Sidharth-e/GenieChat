"use client";

import { create } from "zustand";
import { WorkflowExecution, WorkflowStep } from "@/lib/types";
import type { NodeRuntimeHistory } from "@/lib/workflow/types";

interface WorkflowsState {
  execution: WorkflowExecution | null;
  nodeHistories: NodeRuntimeHistory[];
  startExecution: (
    workflowId: string,
    workflowName: string,
    steps: WorkflowStep[],
    userMessage: string,
  ) => void;
  stopExecution: () => void;
  updateExecutionStep: (
    stepIndex: number,
    status: WorkflowStep["status"],
    result?: string,
  ) => void;
  completeExecution: () => void;
  failExecution: (error: string) => void;
  addNodeHistory: (history: NodeRuntimeHistory) => void;
  updateNodeHistory: (id: string, updates: Partial<NodeRuntimeHistory>) => void;
  clearNodeHistories: () => void;
}

/**
 * Client-side state for workflow execution.
 * Server state (workflows list, loading, errors) is managed by React Query hooks.
 */
export const useWorkflowsStore = create<WorkflowsState>()((set) => ({
  execution: null,
  nodeHistories: [],

  startExecution: (workflowId, workflowName, steps, userMessage) => {
    set({
      execution: {
        id: "temp-id",
        workflowId,
        userId: "current-user",
        userName: "Current User",
        userEmail: "current-user@local",
        title: workflowName,
        status: "running",
        startTime: new Date().toISOString(),
        currentStepIndex: 0,
        initialInput: userMessage,
        steps: steps.map((s) => ({
          stepId: s.id,
          stepName: s.name,
          agentId: s.agentId,
          status: "pending" as const,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  stopExecution: () => {
    set({ execution: null });
  },

  updateExecutionStep: (stepIndex, status, result) => {
    set((state) => {
      if (!state.execution) return state;

      const newSteps = [...state.execution.steps];
      if (newSteps[stepIndex]) {
        newSteps[stepIndex] = {
          ...newSteps[stepIndex],
          status:
            status === "completed" || status === "error" || status === "running"
              ? status
              : newSteps[stepIndex].status,
          output: result || newSteps[stepIndex].output,
          error: status === "error" ? result : undefined,
        };
      }

      return {
        execution: {
          ...state.execution,
          currentStepIndex:
            status === "running" ? stepIndex : state.execution.currentStepIndex,
          steps: newSteps,
        },
      };
    });
  },

  completeExecution: () => {
    set((state) => ({
      execution: state.execution
        ? { ...state.execution, status: "completed" }
        : null,
    }));
  },

  failExecution: (error) => {
    set((state) => ({
      execution: state.execution
        ? { ...state.execution, status: "error", error }
        : null,
    }));
  },

  addNodeHistory: (history) => {
    set((state) => ({
      nodeHistories: [...state.nodeHistories, history],
    }));
  },

  updateNodeHistory: (id, updates) => {
    set((state) => ({
      nodeHistories: state.nodeHistories.map((h) =>
        h.id === id ? { ...h, ...updates } : h,
      ),
    }));
  },

  clearNodeHistories: () => {
    set({ nodeHistories: [] });
  },
}));
