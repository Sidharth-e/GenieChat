import { create } from "zustand";
import { Message } from "@/lib/types";

export type MachineStatus = "idle" | "streaming" | "executing_tool" | "thinking" | "error";

export interface LiveAuditLog {
  id: string;
  time: string;
  action: string;
  detail?: string;
  type?: "system" | "tool" | "model" | "user" | "error";
}

export interface LiveTokens {
  prompt: number;
  completion: number;
  total: number;
}

interface MachineStateState {
  isOpen: boolean;
  machineStatus: MachineStatus;
  liveToolName: string | null;
  liveTokens: LiveTokens | null;
  liveAuditLogs: LiveAuditLog[];
  activeMessages: Message[];
  activeThreadId: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setMachineStatus: (status: MachineStatus, toolName?: string | null) => void;
  setLiveTokens: (tokens: LiveTokens | null) => void;
  setActiveMessages: (messages: Message[]) => void;
  setActiveThreadId: (threadId: string | null) => void;
  addAuditLog: (log: Omit<LiveAuditLog, "id" | "time"> & { time?: string }) => void;
  clearLiveLogs: () => void;
  resetSessionState: () => void;
}

const formatCurrentTime = (): string => {
  const now = new Date();
  return now.toTimeString().split(" ")[0];
};

export const useMachineStateStore = create<MachineStateState>((set) => ({
  isOpen: false,
  machineStatus: "idle",
  liveToolName: null,
  liveTokens: null,
  liveAuditLogs: [],
  activeMessages: [],
  activeThreadId: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setMachineStatus: (status, toolName = null) =>
    set({ machineStatus: status, liveToolName: toolName }),
  setLiveTokens: (tokens) => set({ liveTokens: tokens }),
  setActiveMessages: (messages) =>
    set((s) => (s.activeMessages === messages ? s : { activeMessages: messages })),
  setActiveThreadId: (threadId) => set({ activeThreadId: threadId }),
  addAuditLog: (log) =>
    set((s) => ({
      liveAuditLogs: [
        ...s.liveAuditLogs.slice(-49),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          time: log.time || formatCurrentTime(),
          action: log.action,
          detail: log.detail,
          type: log.type || "system",
        },
      ],
    })),
  clearLiveLogs: () => set({ liveAuditLogs: [] }),
  resetSessionState: () =>
    set({
      machineStatus: "idle",
      liveToolName: null,
      liveTokens: null,
      liveAuditLogs: [],
      activeMessages: [],
      activeThreadId: null,
    }),
}));
