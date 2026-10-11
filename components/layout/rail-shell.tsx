import { NavRail } from "@/components/layout/nav-rail";
import { CanvasPanel } from "@/components/chat/canvas-panel";
import { MachineStatePanel } from "@/components/chat/machine-state-panel";

/**
 * The frame for the `(rail)` group — nav rail, content column, and the two chat
 * inspector panels docked beside it. It reads no route: the chat header is
 * `ConversationShell`'s, because that is the component that knows a conversation
 * is what it is rendering.
 */
export function RailShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavRail />

      <main className="relative flex h-screen flex-1 overflow-hidden transition-all duration-300 ease-in-out">
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
        </div>
        <CanvasPanel />
        <MachineStatePanel />
      </main>
    </div>
  );
}
