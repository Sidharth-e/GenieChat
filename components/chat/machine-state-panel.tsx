"use client";

import { X, Check } from "lucide-react";
import { useMachineStateStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

const CONTEXT_FILES = [
  { name: "Q3_retention.csv", done: true },
  { name: "user_interviews.pdf", done: false },
];

const AUDIT = [
  { time: "10:01:45", action: "Parsed Q3_retention.csv", detail: "4,521 rows" },
];

export function MachineStatePanel() {
  const { isOpen, close } = useMachineStateStore();

  return (
    <aside
      className={cn(
        "bg-card-bg border-l border-card-border transition-all duration-300 flex flex-col shrink-0 z-30",
        "absolute right-0 top-0 h-full md:relative",
        isOpen
          ? "w-80 translate-x-0"
          : "w-0 translate-x-full md:translate-x-0 overflow-hidden border-l-0 pointer-events-none opacity-0 md:opacity-0",
      )}
    >
      <div className="h-12 p-4 border-b border-card-border flex items-center justify-between shrink-0">
        <h3 className="font-mono text-[10px] uppercase tracking-widest font-medium text-foreground">
          Machine State
        </h3>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--green)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />{" "}
          Idle
        </span>
        <button
          onClick={close}
          className="md:hidden text-tertiary/40 hover:text-foreground cursor-pointer"
          aria-label="Close machine state panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] text-tertiary/50">
        <div className="mb-6">
          <h4 className="font-sans text-xs text-foreground mb-2 border-b border-card-border pb-1">
            Context Window
          </h4>
          <ul className="space-y-2">
            {CONTEXT_FILES.map((f) => (
              <li
                key={f.name}
                className={cn(
                  "flex items-center justify-between",
                  !f.done && "opacity-50",
                )}
              >
                <span>{f.name}</span>
                {f.done ? (
                  <Check className="w-3 h-3 text-[var(--green)]" />
                ) : (
                  <span>pending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-sans text-xs text-foreground mb-2 border-b border-card-border pb-1">
            Audit Trail
          </h4>
          <div className="space-y-3">
            {AUDIT.map((a) => (
              <div key={a.time} className="border-l border-card-border pl-2">
                <span className="block text-tertiary/40 mb-1">{a.time}</span>
                <span className="text-foreground block">{a.action}</span>
                <span className="text-tertiary/40 block mt-1">{a.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
