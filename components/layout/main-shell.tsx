"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/nav-rail";
import { Header } from "@/components/chat/header";
import { CanvasPanel } from "@/components/chat/canvas-panel";
import { MachineStatePanel } from "@/components/chat/machine-state-panel";
import { cn } from "@/lib/utils";

interface MainShellProps {
  children: React.ReactNode;
  showHeader?: boolean;
}

export function MainShell({ children, showHeader = true }: MainShellProps) {
  const pathname = usePathname();
  const isConversationRoute = Boolean(
    pathname &&
      (/^\/chat\/(?!new$|history$).+/.test(pathname) ||
        pathname.startsWith("/agent-chat") ||
        pathname.startsWith("/multi-agent-chat") ||
        pathname.startsWith("/swarm-chat")),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavRail />

      <main
        className={cn(
          "relative flex h-screen flex-1 overflow-hidden transition-all duration-300 ease-in-out",
        )}
      >
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {showHeader && isConversationRoute ? (
            <Header inlineOnMobile />
          ) : null}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
        </div>
        <CanvasPanel />
        <MachineStatePanel />
      </main>
    </div>
  );
}
