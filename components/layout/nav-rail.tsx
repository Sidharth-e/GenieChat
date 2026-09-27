"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Hammer,
  FolderOpen,
  Zap,
  NotebookTabs,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  RAIL_ITEMS,
  BUILD_ITEMS,
  LIBRARY_ITEMS,
} from "@/constants/routes";
import { AI_NAME } from "@/constants/main";
import { useQuickActionsStore } from "@/lib/stores";
import { NotesModal } from "@/components/chat/notes-modal";
import { ThemeToggleButton } from "@/components/common/theme-toggle-button";
import { UserMenu } from "@/components/common/user-menu";

export function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { setIsModalOpen } = useQuickActionsStore();
  const [isNotesOpen, setIsNotesOpen] = useState(false);

  useEffect(() => {
    const routesToPrefetch = Array.from(
      new Set([
        "/chat/new",
        "/agents",
        "/connectors",
        "/workflow",
        "/chat/history",
        ...BUILD_ITEMS.map((item) => item.href),
        ...LIBRARY_ITEMS.map((item) => item.href),
      ]),
    );
    routesToPrefetch.forEach((route) => router.prefetch(route));
  }, [router]);

  const isHomeActive = pathname === "/chat/new";
  const isAgentsActive =
    pathname === "/agents" || pathname.startsWith("/agents/");
  const isMcpActive = pathname === "/mcp" || pathname.startsWith("/mcp/");
  const isWorkflowActive =
    pathname === "/workflow" || pathname.startsWith("/workflow/");
  const isHistoryActive =
    pathname === "/chat/history" || pathname.startsWith("/chat/history/");

  const isBuildActive = BUILD_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(item.href),
  );
  const isLibraryActive = LIBRARY_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(item.href),
  );

  const getRailItemState = (label: string) => {
    if (label === "Home") return { href: "/chat/new", active: isHomeActive };
    if (label === "Agents") return { href: "/agents", active: isAgentsActive };
    if (label === "Connectors" || label === "MCP") return { href: "/mcp", active: isMcpActive };
    if (label === "Workflows") return { href: "/workflow", active: isWorkflowActive };
    if (label === "History") return { href: "/chat/history", active: isHistoryActive };
    return { href: "/chat/new", active: false };
  };

  const mainRailItems = RAIL_ITEMS.slice(0, 4);
  const historyItem = RAIL_ITEMS[4];

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="w-16 shrink-0 border-r border-card-border bg-card-bg flex flex-col items-center py-4 z-40 relative h-screen">
        <Link
          href="/chat/new"
          className="mb-2 text-foreground p-1 rounded-sm hover:opacity-80 transition-opacity flex items-center justify-center"
          aria-label={AI_NAME}
        >
          <Image
            src="/genie.png"
            alt={AI_NAME}
            width={36}
            height={36}
            className="w-9 h-9 object-contain"
            priority
          />
        </Link>

        <nav className="flex flex-col gap-2 w-full items-center">
          {mainRailItems.map((item) => {
            const { href, active } = getRailItemState(item.label);
            const Icon = item.icon;
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors",
                      active && "bg-tertiary/8 text-foreground",
                    )}
                    aria-label={item.label}
                  >
                    <Icon className="w-5 h-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={14}
                  className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors cursor-pointer",
                      isBuildActive && "bg-tertiary/8 text-foreground",
                    )}
                    aria-label="Build"
                  >
                    <Hammer className="w-5 h-5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={14}
                className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
              >
                Build
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side="right"
              sideOffset={14}
              className="min-w-[180px] bg-dropdown-bg border-card-border p-1.5 rounded-sm shadow-xl z-50"
            >
              {BUILD_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(item.href);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer",
                        active && "bg-tertiary/8 font-medium",
                      )}
                    >
                      <Icon className="w-4 h-4 text-tertiary/60" />
                      <span>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors cursor-pointer",
                      isLibraryActive && "bg-tertiary/8 text-foreground",
                    )}
                    aria-label="Library"
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={14}
                className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
              >
                Library
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side="right"
              sideOffset={14}
              className="min-w-[180px] bg-dropdown-bg border-card-border p-1.5 rounded-sm shadow-xl z-50"
            >
              {LIBRARY_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(item.href);
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer",
                        active && "bg-tertiary/8 font-medium",
                      )}
                    >
                      <Icon className="w-4 h-4 text-tertiary/60" />
                      <span>{item.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {historyItem && (() => {
            const { href, active } = getRailItemState(historyItem.label);
            const Icon = historyItem.icon;
            return (
              <Tooltip key={historyItem.label}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors",
                      active && "bg-tertiary/8 text-foreground",
                    )}
                    aria-label={historyItem.label}
                  >
                    <Icon className="w-5 h-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={14}
                  className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
                >
                  {historyItem.label}
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </nav>

        <div className="mt-auto flex flex-col gap-2 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="p-3 rounded-sm text-tertiary/40 hover:text-foreground hover:bg-tertiary/8 transition-colors cursor-pointer"
                aria-label="Quick Actions"
              >
                <Zap className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={14}
              className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
            >
              Quick Actions
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsNotesOpen(true)}
                className={cn(
                  "p-3 rounded-sm text-tertiary/40 hover:text-foreground hover:bg-tertiary/8 transition-colors cursor-pointer",
                  isNotesOpen && "bg-tertiary/8 text-foreground",
                )}
                aria-label="Notes"
              >
                <NotebookTabs className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={14}
              className="bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs"
            >
              Notes
            </TooltipContent>
          </Tooltip>

          <ThemeToggleButton />
          <UserMenu variant="avatar" />
        </div>

        <NotesModal open={isNotesOpen} onOpenChange={setIsNotesOpen} />
      </aside>
    </TooltipProvider>
  );
}
