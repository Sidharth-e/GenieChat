"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ContentLayoutProps {
  title: string;
  /** Omit it and the subtitle line is not rendered at all. */
  description?: string;
  children: React.ReactNode;
  className?: string;

  // Search & Action Props
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actionButton?: React.ReactNode;

  // Optional navigation (e.g., tabs)
  navigation?: React.ReactNode;

  /**
   * `"stacked"` (default) keeps the title, the search row and the tabs in
   * three bands, which is what every existing caller relies on.
   *
   * `"inline"` moves the search and the action button up onto the title's row
   * and shrinks the search to a fixed width, so the header reads as one line.
   * Opt-in, so no caller changes rendering by not passing it.
   */
  headerLayout?: "stacked" | "inline";

  /**
   * The rule under the tab strip. On by default, because the stacked header
   * reads as a section boundary; the inline toolbar variant is borderless.
   */
  navigationBordered?: boolean;
}

export function ContentLayout({
  title,
  description,
  children,
  className,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  actionButton,
  navigation,
  headerLayout = "stacked",
  navigationBordered = true,
}: ContentLayoutProps) {
  const isInline = headerLayout === "inline";

  const titleBlock = (
    <div className={cn(isInline ? "shrink-0 space-y-1" : "space-y-1.5")}>
      <h1 className="font-serif text-3xl text-foreground md:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-text-secondary">{description}</p>
      )}
    </div>
  );

  const searchField = onSearchChange ? (
    <div className={cn("relative", isInline ? "w-full lg:w-64" : "flex-1")}>
      <Search
        className={cn(
          "absolute left-3 text-text-secondary",
          isInline ? "top-1/2 h-4 w-4 -translate-y-1/2" : "top-2.5 h-4 w-4",
        )}
      />
      <Input
        placeholder={searchPlaceholder || "Search..."}
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        className={cn(
          "border-card-border bg-card-bg pl-9 shadow-none",
          isInline ? "h-9 rounded-full" : "h-10",
        )}
      />
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl px-4 pb-5 pt-14 md:px-8 md:pt-20 animate-in fade-in duration-300",
        className,
      )}
    >
      <header className="space-y-6">
        {isInline ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
            {titleBlock}
            {/* Toggle before search, matching the reference toolbar: the
                view switch sits at the left of the control cluster, then the
                search field, then trailing actions. */}
            <div className="flex items-center gap-2 lg:flex-1 lg:justify-end">
              {actionButton}
              {searchField}
            </div>
          </div>
        ) : (
          <>
            {titleBlock}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {searchField}
              {actionButton}
            </div>
          </>
        )}

        {navigation && (
          <nav
            className={cn(
              navigationBordered && "border-b border-card-border",
            )}
          >
            {navigation}
          </nav>
        )}
      </header>

      <section className="pt-5">{children}</section>
    </div>
  );
}
