"use client";

import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useThreads,
  useDeleteThread,
  useShareThread,
  useToggleBookmark,
} from "@/hooks/use-threads-queries";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Search,
  Plus,
  Image as ImageIcon,
  Paperclip,
  Calendar,
  Bookmark as BookmarkIcon,
  Trash2,
  Share2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { isToday, isYesterday, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Message, Thread } from "@/lib/types";
import { ShareModal } from "@/components/share/share-modal";
import { DeleteConfirmationModal } from "@/components/common/delete-confirmation-modal";
import { formatRelativeTime } from "@/lib/relative-time";

type ActivityFilter = "all" | "attachments" | "images" | "bookmarks";
type DateFilter = "any" | "today" | "yesterday" | "last7" | "last30" | "older";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "any", label: "Any Date" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "last30", label: "Last 30 Days" },
  { value: "older", label: "Older than 30 Days" },
];

export function ChatHistory() {
  const router = useRouter();
  const topAnchorRef = React.useRef<HTMLDivElement>(null);
  const { data: threads = [], isLoading } = useThreads();
  const { mutateAsync: deleteThread, isPending: isDeletingThread } =
    useDeleteThread();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<ActivityFilter>("all");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("any");
  const [pageSize, setPageSize] =
    React.useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isPageSwitching, setIsPageSwitching] = React.useState(false);
  const [sharingThread, setSharingThread] = React.useState<Thread | null>(null);
  const [threadToDelete, setThreadToDelete] = React.useState<Thread | null>(
    null,
  );
  const { mutateAsync: shareThread } = useShareThread();

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const normalizedSearchQuery = debouncedSearchQuery.trim().toLowerCase();

  const threadsAfterFacetFilters = React.useMemo(() => {
    return threads.filter((thread) => {
      if (activeFilter === "images" && (thread.imageCount || 0) === 0) {
        return false;
      }
      if (
        activeFilter === "attachments" &&
        (thread.attachmentCount || 0) === 0
      ) {
        return false;
      }
      if (activeFilter === "bookmarks" && !thread.isBookmarked) {
        return false;
      }
      return matchesDateFilter(
        thread.lastMessageAt || thread.updatedAt,
        dateFilter,
      );
    });
  }, [threads, activeFilter, dateFilter]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearchQuery, activeFilter, dateFilter, pageSize]);

  const previewThreadIds = React.useMemo(() => {
    if (normalizedSearchQuery) {
      return threadsAfterFacetFilters.map((thread) => thread.id);
    }
    const startIndex = (currentPage - 1) * pageSize;
    return threadsAfterFacetFilters
      .slice(startIndex, startIndex + pageSize)
      .map((thread) => thread.id);
  }, [normalizedSearchQuery, threadsAfterFacetFilters, currentPage, pageSize]);

  const previewQueries = useQueries({
    queries: previewThreadIds.map((threadId) => ({
      queryKey: ["thread-messages", threadId],
      queryFn: () => fetchThreadMessages(threadId),
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    })),
  });

  const previewByThreadId = React.useMemo(() => {
    const previews: Record<string, string> = {};
    previewThreadIds.forEach((threadId, index) => {
      const query = previewQueries[index];
      if (query?.data) {
        previews[threadId] = buildThreadPreview(query.data);
      }
    });
    return previews;
  }, [previewThreadIds, previewQueries]);

  const previewLoadingByThreadId = React.useMemo(() => {
    const loading: Record<string, boolean> = {};
    previewThreadIds.forEach((threadId, index) => {
      const query = previewQueries[index];
      loading[threadId] = Boolean(
        query && (query.isPending || query.isFetching),
      );
    });
    return loading;
  }, [previewThreadIds, previewQueries]);

  const previewResolvedByThreadId = React.useMemo(() => {
    const resolved: Record<string, boolean> = {};
    previewThreadIds.forEach((threadId, index) => {
      const query = previewQueries[index];
      resolved[threadId] = Boolean(query && (query.isSuccess || query.isError));
    });
    return resolved;
  }, [previewThreadIds, previewQueries]);

  const filteredThreads = React.useMemo(() => {
    if (!normalizedSearchQuery) {
      return threadsAfterFacetFilters;
    }

    return threadsAfterFacetFilters.filter((thread) => {
      const titleMatch = thread.title
        .toLowerCase()
        .includes(normalizedSearchQuery);
      if (titleMatch) {
        return true;
      }

      const previewResolved = previewResolvedByThreadId[thread.id];
      if (!previewResolved) {
        return false;
      }

      const preview = previewByThreadId[thread.id] || "";
      return preview.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [
    normalizedSearchQuery,
    threadsAfterFacetFilters,
    previewByThreadId,
    previewResolvedByThreadId,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredThreads.length / pageSize));

  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedThreads = React.useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredThreads.slice(startIndex, startIndex + pageSize);
  }, [filteredThreads, currentPage, pageSize]);

  const paginationPages = React.useMemo(
    () => getVisiblePageNumbers(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const currentPageItemCount = React.useMemo(() => {
    const remaining = filteredThreads.length - (currentPage - 1) * pageSize;
    return Math.max(0, Math.min(pageSize, remaining));
  }, [filteredThreads.length, currentPage, pageSize]);

  React.useEffect(() => {
    if (!isPageSwitching) {
      return;
    }

    if (currentPageItemCount === 0) {
      setIsPageSwitching(false);
      return;
    }

    const isAnyPreviewStillLoading = paginatedThreads.some(
      (thread) => previewLoadingByThreadId[thread.id],
    );

    if (!isAnyPreviewStillLoading) {
      const timeout = setTimeout(() => {
        setIsPageSwitching(false);
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [
    isPageSwitching,
    currentPageItemCount,
    paginatedThreads,
    previewLoadingByThreadId,
  ]);

  const isSearchingMessages =
    Boolean(normalizedSearchQuery) &&
    previewQueries.some((query) => query.isPending || query.isFetching);

  const goToPage = React.useCallback(
    (page: number) => {
      const clampedPage = Math.min(Math.max(1, page), totalPages);
      if (clampedPage === currentPage) {
        return;
      }
      topAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setIsPageSwitching(true);
      setCurrentPage(clampedPage);
    },
    [currentPage, totalPages],
  );

  const handleNewChat = () => {
    router.push("/chat/new");
  };

  const getThreadRoute = (thread: Thread) => {
    if (thread.isSwarm) {
      return `/swarm-chat/${thread.id}`;
    }
    if (thread.agentId) {
      if (thread.isMultiAgent) {
        return `/multi-agent-chat/${thread.agentId}/${thread.id}`;
      }
      return `/agent-chat/${thread.agentId}/${thread.id}`;
    }
    return `/chat/${thread.id}`;
  };

  const handleThreadClick = (thread: Thread) => {
    router.push(getThreadRoute(thread));
  };

  const handleToggleShare = async (
    enable: boolean,
    shareMode?: "public" | "specific",
    sharedWith?: { id: string; displayName: string; email: string }[],
  ) => {
    if (!sharingThread) return;
    await shareThread({
      threadId: sharingThread.id,
      enable,
      shareMode,
      sharedWith,
    });
    setSharingThread(null);
  };

  const getShareUrl = (thread: Thread): string | null =>
    typeof window === "undefined" || !thread.shareId
      ? null
      : `${window.location.origin}/share/${thread.shareId}`;

  const handleConfirmDelete = async () => {
    if (!threadToDelete) return;
    await deleteThread(threadToDelete.id);
    setThreadToDelete(null);
  };

  const resultLabel =
    filteredThreads.length === threads.length
      ? `${threads.length}`
      : `${filteredThreads.length}/${threads.length}`;
  const startItem =
    filteredThreads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, filteredThreads.length);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-5 pt-14 md:px-8 md:pt-20 animate-in fade-in duration-300">
      <div ref={topAnchorRef} />
      <header className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="font-serif text-3xl text-foreground md:text-4xl">
            Session History
          </h1>
          <p className="text-sm text-text-secondary">
            Review and manage your previous conversations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tertiary/40" />
            <input
              type="text"
              placeholder="Search past workspaces or outputs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card-bg border border-card-border py-2 pl-10 pr-4 text-sm font-sans rounded-sm focus:outline-none focus:border-tertiary/60 text-foreground placeholder:text-tertiary/40"
            />
          </div>
          <button
            onClick={handleNewChat}
            className="h-10 rounded-sm bg-primary text-background px-4 text-sm font-medium hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer shrink-0"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
        </div>

        {isSearchingMessages && (
          <div className="text-xs text-text-secondary">
            Searching message content...
          </div>
        )}

        <div className="flex flex-col gap-3 border-b border-card-border pb-2 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto hide-scrollbar">
            <FilterButton
              active={activeFilter === "all"}
              onClick={() => setActiveFilter("all")}
              label={`All Chats (${resultLabel})`}
            />
            <FilterButton
              active={activeFilter === "attachments"}
              onClick={() => setActiveFilter("attachments")}
              label="Attachments"
              icon={<Paperclip className="h-3.5 w-3.5" />}
            />
            <FilterButton
              active={activeFilter === "images"}
              onClick={() => setActiveFilter("images")}
              label="Images"
              icon={<ImageIcon className="h-3.5 w-3.5" />}
            />
            <FilterButton
              active={activeFilter === "bookmarks"}
              onClick={() => setActiveFilter("bookmarks")}
              label="Bookmarks"
              icon={<BookmarkIcon className="h-3.5 w-3.5" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pb-1 md:shrink-0 md:justify-end md:pb-0">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Calendar className="h-3.5 w-3.5" />
              <Select
                value={dateFilter}
                onChange={(v) => setDateFilter(v as DateFilter)}
                options={DATE_FILTER_OPTIONS}
                size="sm"
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="whitespace-nowrap">Per page</span>
              <Select
                value={String(pageSize)}
                onChange={(v) =>
                  setPageSize(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number])
                }
                options={PAGE_SIZE_OPTIONS.map((size) => ({
                  value: String(size),
                  label: String(size),
                }))}
                size="sm"
              />
            </div>
          </div>
        </div>
      </header>

      <section className="pb-10 pt-5">
        {isLoading ? (
          <div className="flex flex-col border-l border-card-border ml-2 pl-6 relative">
            {Array.from({ length: pageSize }).map((_, index) => (
              <ThreadCardSkeleton key={`loading-${index}`} />
            ))}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="rounded-sm border border-dashed border-card-border bg-card-bg p-10 text-center">
            <h3 className="text-base font-semibold text-foreground">
              No conversations found
            </h3>
            <p className="mt-1 text-sm text-text-secondary">
              Try starting a new chat or adjusting your filters.
            </p>
          </div>
        ) : isPageSwitching ? (
          <div className="flex flex-col border-l border-card-border ml-2 pl-6 relative">
            {Array.from({ length: currentPageItemCount || pageSize }).map(
              (_, index) => <ThreadCardSkeleton key={`skeleton-${index}`} />,
            )}
          </div>
        ) : (
          <div className="flex flex-col border-l border-card-border ml-2 pl-6 relative">
            {paginatedThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                preview={previewByThreadId[thread.id]}
                isPreviewLoading={previewLoadingByThreadId[thread.id]}
                onClick={() => handleThreadClick(thread)}
                onShare={() => setSharingThread(thread)}
                onDelete={() => setThreadToDelete(thread)}
              />
            ))}
          </div>
        )}
      </section>

      {!isLoading && filteredThreads.length > 0 && (
        <div className="mb-8 mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-secondary">
            Showing {startItem}-{endItem} of {filteredThreads.length}
          </p>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="h-8 rounded-md px-2"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {paginationPages.map((page) => (
                <Button
                  key={page}
                  size="sm"
                  variant={page === currentPage ? "default" : "ghost"}
                  onClick={() => goToPage(page)}
                  className="h-8 min-w-8 rounded-md px-2"
                >
                  {page}
                </Button>
              ))}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="h-8 rounded-md px-2"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {sharingThread && (
        <ShareModal
          isOpen={true}
          onClose={() => setSharingThread(null)}
          isShared={sharingThread.isShared}
          shareUrl={sharingThread.shareId ? getShareUrl(sharingThread) : null}
          shareMode={sharingThread.shareMode}
          sharedWith={sharingThread.sharedWith}
          onToggleShare={handleToggleShare}
        />
      )}

      <DeleteConfirmationModal
        isOpen={!!threadToDelete}
        onClose={() => setThreadToDelete(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeletingThread}
        title="Delete Chat"
        description="Are you sure you want to delete this chat? This action cannot be undone."
      />
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "font-mono text-[10px] uppercase tracking-widest pb-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap",
        active
          ? "text-foreground border-b border-foreground"
          : "text-tertiary/40 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ThreadCard({
  thread,
  onClick,
  onShare,
  onDelete,
  preview,
  isPreviewLoading,
}: {
  thread: Thread;
  onClick: () => void;
  onShare: () => void;
  onDelete: () => void;
  preview?: string;
  isPreviewLoading?: boolean;
}) {
  const { mutate: toggleBookmark } = useToggleBookmark();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBookmark(thread.id);
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShare();
  };

  const formattedTime =
    formatRelativeTime(thread.lastMessageAt || thread.updatedAt) ||
    formatThreadDate(thread.updatedAt);

  return (
    <div className="relative pb-10 group">
      <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full bg-tertiary/20 group-hover:bg-foreground transition-colors" />

      <div className="flex items-center justify-between gap-4 mb-1">
        <span className="font-mono text-xs text-tertiary/40">
          {formattedTime}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleBookmark}
            className={cn(
              "rounded-sm p-1 text-tertiary/40 transition-colors hover:text-foreground cursor-pointer",
              thread.isBookmarked && "text-foreground",
            )}
            title={thread.isBookmarked ? "Remove Bookmark" : "Bookmark"}
            aria-label="Bookmark"
          >
            <BookmarkIcon
              className={cn("w-3.5 h-3.5", thread.isBookmarked && "fill-current")}
            />
          </button>
          <button
            onClick={handleShare}
            className="rounded-sm p-1 text-tertiary/40 transition-colors hover:text-foreground cursor-pointer"
            title="Share"
            aria-label="Share"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDelete}
            className="rounded-sm p-1 text-tertiary/40 transition-colors hover:text-[var(--red)] cursor-pointer"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        onClick={onClick}
        className="font-sans text-base text-foreground mb-1 cursor-pointer hover:underline inline-block font-medium"
      >
        {thread.title || "Untitled Conversation"}
      </div>

      {(preview || isPreviewLoading) && (
        <p className="font-serif text-sm text-text-secondary italic max-w-2xl line-clamp-2">
          {isPreviewLoading ? "Loading latest message..." : `"${preview}"`}
        </p>
      )}
    </div>
  );
}

function ThreadCardSkeleton() {
  return (
    <div className="relative pb-10">
      <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full bg-tertiary/20" />
      <div className="animate-pulse space-y-2">
        <div className="h-3 w-20 bg-hover-bg rounded-xs" />
        <div className="h-4 w-64 bg-hover-bg rounded-xs" />
        <div className="h-3 w-96 bg-hover-bg rounded-xs" />
      </div>
    </div>
  );
}

function formatThreadDate(dateString: string) {
  try {
    const date = new Date(dateString);
    if (isToday(date)) {
      return `Today, ${format(date, "h:mm a")}`;
    }
    if (isYesterday(date)) {
      return `Yesterday, ${format(date, "h:mm a")}`;
    }
    return format(date, "MMM d, yyyy");
  } catch {
    return "";
  }
}

function normalizePreviewText(content: string): string {
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, " [code] ");
  const withoutInlineCode = withoutCodeBlocks.replace(/`([^`]+)`/g, "$1");
  const withoutLinks = withoutInlineCode.replace(
    /\[([^\]]+)\]\([^)]+\)/g,
    "$1",
  );
  const withoutFormatting = withoutLinks.replace(/[#>*_~-]/g, " ");
  return withoutFormatting.replace(/\s+/g, " ").trim();
}

function buildThreadPreview(messages: Message[]): string {
  if (messages.length === 0) {
    return "No messages yet.";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const normalized = normalizePreviewText(message.content || "");
    if (normalized) {
      return normalized.length > 180
        ? `${normalized.slice(0, 177).trimEnd()}...`
        : normalized;
    }
  }

  const latestMessage = messages[messages.length - 1];
  const imageCount = latestMessage.images?.length || 0;
  const attachmentCount = latestMessage.documents?.length || 0;

  if (imageCount > 0 || attachmentCount > 0) {
    const labels: string[] = [];
    if (imageCount > 0) {
      labels.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
    }
    if (attachmentCount > 0) {
      labels.push(
        `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`,
      );
    }
    return `Shared ${labels.join(" and ")}`;
  }

  return "No message content available yet.";
}

function matchesDateFilter(dateString: string, filter: DateFilter): boolean {
  if (filter === "any") {
    return true;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const startOfLast7Days = new Date(startOfToday);
  startOfLast7Days.setDate(startOfLast7Days.getDate() - 7);

  const startOfLast30Days = new Date(startOfToday);
  startOfLast30Days.setDate(startOfLast30Days.getDate() - 30);

  if (filter === "today") {
    return date >= startOfToday;
  }
  if (filter === "yesterday") {
    return date >= startOfYesterday && date < startOfToday;
  }
  if (filter === "last7") {
    return date >= startOfLast7Days;
  }
  if (filter === "last30") {
    return date >= startOfLast30Days;
  }
  return date < startOfLast30Days;
}

function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  maxVisible = 5,
): number[] {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const half = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage - half);
  let end = start + maxVisible - 1;

  if (end > totalPages) {
    end = totalPages;
    start = end - maxVisible + 1;
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

async function fetchThreadMessages(threadId: string): Promise<Message[]> {
  const response = await fetch(
    `/api/chat/threads/${encodeURIComponent(threadId)}`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch thread messages");
  }
  return response.json();
}
