"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Thread } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Star,
  Trash2,
  Pencil,
  MoreVertical,
  Users,
  Bot,
  MessageSquare,
  Network,
} from "lucide-react";

import { createPortal } from "react-dom";

interface ThreadItemProps {
  thread: Thread;
  onDelete: (threadId: string) => void;
  onToggleBookmark: (threadId: string) => void;
  onRename?: (threadId: string, title: string) => void;
}

export function ThreadItem({
  thread,
  onDelete,
  onToggleBookmark,
  onRename,
}: ThreadItemProps) {
  const pathname = usePathname();
  const threadUrl = thread.isSwarm
    ? `/swarm-chat/${thread.id}`
    : thread.isMultiAgent && thread.agentId
      ? `/multi-agent-chat/${thread.agentId}/${thread.id}`
      : thread.agentId
        ? `/agent-chat/${thread.agentId}/${thread.id}`
        : `/chat/${thread.id}`;
  const isActive = pathname === threadUrl || pathname === `/chat/${thread.id}`;
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      // Block scrolling when menu is open to prevent detachment
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  const handleOpenMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const MENU_WIDTH = 224; // w-56 is 14rem = 224px

    let left = rect.left;
    // Check if menu would overflow right side of screen
    if (rect.left + MENU_WIDTH > window.innerWidth - 10) {
      // Align right edge of menu with right edge of trigger button
      left = rect.right - MENU_WIDTH;
    }

    setMenuPosition({
      top: rect.bottom + 5,
      left: left,
    });
    setIsMenuOpen(true);
  };

  return (
    <div className="group relative flex items-center pr-2">
      <Link
        href={threadUrl}
        className={cn(
          "flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 ease-in-out min-w-16 h-9",
          "hover:bg-tertiary/5",
          isActive
            ? "bg-secondary font-medium text-tertiary shadow-sm ring-1 ring-tertiary/10"
            : "text-tertiary/60"
        )}
      >
        {thread.isSwarm ? (
          <Network className="h-4 w-4 shrink-0 text-tertiary/50" />
        ) : thread.isMultiAgent ? (
          <Users className="h-4 w-4 shrink-0 text-tertiary/50" />
        ) : thread.agentId ? (
          <Bot className="h-4 w-4 shrink-0 text-tertiary/50" />
        ) : (
          <MessageSquare className="h-4 w-4 shrink-0 text-tertiary/50" />
        )}
        {thread.isBookmarked && (
          <Star className="h-4 w-4 shrink-0 fill-primary text-primary transition-transform hover:scale-110" />
        )}
        {/* Added 'pr-6' to ensure text truncates before hitting the menu button area */}
        <span className="truncate pr-4">{thread.title || "New Chat"}</span>
      </Link>

      {/* Menu Trigger */}
      <div
        className={cn(
          "absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-all duration-200 flex items-center",
          "group-hover:opacity-100",
          isMenuOpen && "opacity-100"
        )}
      >
        <button
          ref={buttonRef}
          onClick={handleOpenMenu}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md text-tertiary/50 transition-colors hover:bg-tertiary/10",
            "bg-secondary shadow-sm border border-tertiary/10",
            isMenuOpen && "bg-tertiary/10 text-tertiary"
          )}
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      </div>

      {/* Portal Menu */}
      {isMenuOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-100 w-56 rounded-lg border border-tertiary/10 bg-dropdown-bg p-1 shadow-xl shadow-black/50 ring-1 ring-white/5 animate-in fade-in zoom-in-95 duration-100"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
            }}
          >
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRename?.(thread.id, thread.title);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-tertiary/80 hover:bg-tertiary/5 whitespace-nowrap"
            >
              <Pencil className="h-4 w-4 text-tertiary/50" />
              Rename
            </button>

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleBookmark(thread.id);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-tertiary/80 hover:bg-tertiary/5 whitespace-nowrap"
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  thread.isBookmarked
                    ? "text-primary fill-primary"
                    : "text-tertiary/50"
                )}
              />
              {thread.isBookmarked
                ? "Remove from Favorites"
                : "Add to Favorites"}
            </button>

            <div className="my-1 h-px bg-tertiary/5" />

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(thread.id);
                setIsMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary hover:bg-primary/10 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              Delete Chat
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
