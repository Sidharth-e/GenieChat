"use client";

import * as React from "react";
import { Thread } from "@/lib/types";
import { ThreadItem } from "./thread-item";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  History,
} from "lucide-react";
import Link from "next/link";

interface ThreadListProps {
  threads: Thread[];
  isLoading?: boolean;
  onDelete?: (threadId: string) => void;
  onToggleBookmark?: (threadId: string) => void;
  onRename?: (threadId: string, title: string) => void;
  limit?: number;
  showViewAll?: boolean;
}

interface ThreadGroupProps {
  title: string;
  items: Thread[];
  defaultOpen?: boolean;
  onDelete: (id: string) => void;
  onToggleBookmark: (id: string) => void;
}

function ThreadGroup({
  title,
  items,
  defaultOpen = true,
  onDelete,
  onToggleBookmark,
}: ThreadGroupProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  if (items.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-tertiary/50 transition-colors hover:text-tertiary/80"
      >
        {isOpen ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
        {title}
        <span className="ml-auto text-[10px] text-tertiary/40">
          {items.length}
        </span>
      </button>

      {isOpen && (
        <div className="space-y-0.5 px-2 animate-in slide-in-from-top-1 duration-200">
          {items.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              onDelete={onDelete}
              onToggleBookmark={onToggleBookmark}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ThreadList({
  threads,
  isLoading,
  onDelete,
  onToggleBookmark,
  limit,
  showViewAll = false,
}: ThreadListProps) {
  // Group threads by date
  const groupedThreads = React.useMemo(() => {
    const today: Thread[] = [];
    const yesterday: Thread[] = [];
    const thisWeek: Thread[] = [];
    const older: Thread[] = [];
    const bookmarked: Thread[] = [];

    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    threads.forEach((thread) => {
      if (thread.isBookmarked) {
        bookmarked.push(thread);
        return; // Don't show in date list if bookmarked? Or duplicates? Usually separate is better.
      }

      const date = new Date(thread.lastMessageAt);
      if (date >= todayStart) {
        today.push(thread);
      } else if (date >= yesterdayStart) {
        yesterday.push(thread);
      } else if (date >= weekStart) {
        thisWeek.push(thread);
      } else {
        older.push(thread);
      }
    });

    return { bookmarked, today, yesterday, thisWeek, older };
  }, [threads]);

  const limitedThreads = React.useMemo(() => {
    if (!limit) return groupedThreads;

    let remaining = limit;
    const limited = {
      bookmarked: [] as Thread[],
      today: [] as Thread[],
      yesterday: [] as Thread[],
      thisWeek: [] as Thread[],
      older: [] as Thread[],
    };

    for (const group of [
      "bookmarked",
      "today",
      "yesterday",
      "thisWeek",
      "older",
    ] as const) {
      if (remaining <= 0) break;
      const take = Math.min(groupedThreads[group].length, remaining);
      limited[group] = groupedThreads[group].slice(0, take);
      remaining -= take;
    }

    return limited;
  }, [groupedThreads, limit]);

  const totalCount = threads.length;
  const displayedCount = limit
    ? Object.values(limitedThreads).reduce((sum, arr) => sum + arr.length, 0)
    : totalCount;

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-tertiary/10" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-lg bg-tertiary/5"
            />
          ))}
        </div>
        <div className="space-y-2">
          <div className="h-4 w-16 animate-pulse rounded bg-tertiary/10" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-lg bg-tertiary/5"
            />
          ))}
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-tertiary/5">
          <MessageSquare className="h-6 w-6 text-tertiary/30" />
        </div>
        <p className="mt-4 text-sm font-medium text-tertiary">
          No conversations yet
        </p>
        <p className="mt-1 text-xs text-tertiary/50 max-w-48">
          Start a new chat to begin your journey.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-tertiary/10">
      <ThreadGroup
        title="Favorites"
        items={limitedThreads.bookmarked}
        onDelete={onDelete!}
        onToggleBookmark={onToggleBookmark!}
      />
      <ThreadGroup
        title="Today"
        items={limitedThreads.today}
        onDelete={onDelete!}
        onToggleBookmark={onToggleBookmark!}
      />
      <ThreadGroup
        title="Yesterday"
        items={limitedThreads.yesterday}
        onDelete={onDelete!}
        onToggleBookmark={onToggleBookmark!}
      />
      <ThreadGroup
        title="Previous 7 Days"
        items={limitedThreads.thisWeek}
        onDelete={onDelete!}
        onToggleBookmark={onToggleBookmark!}
      />
      <ThreadGroup
        title="Older"
        items={limitedThreads.older}
        defaultOpen={false}
        onDelete={onDelete!}
        onToggleBookmark={onToggleBookmark!}
      />

      {showViewAll && totalCount > displayedCount && (
        <Link
          href="/chat/history"
          className="flex items-center gap-2 mx-2 mt-3 px-3 py-2 text-sm font-medium text-primary/70 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
        >
          <History className="h-4 w-4" />
          View All History
          <span className="ml-auto text-xs text-tertiary/50">
            {totalCount} total
          </span>
        </Link>
      )}
    </div>
  );
}
