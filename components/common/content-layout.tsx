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

  // Optional navigation (e.g., filters)
  navigation?: React.ReactNode;

  /**
   * `"full"` (the default) runs the content from the rail to the right edge,
   * which is what a wall of tiles, a card grid and a data table all want.
   *
   * `"bounded"` holds the centred `max-w-6xl` column, for form-shaped pages
   * where a full-width field would be unreadable across a wide monitor.
   */
  width?: "full" | "bounded";
}

/**
 * The frame every list page shares: one title row carrying the action button
 * and the search field, then an optional filter strip, then the content.
 *
 * The strip is borderless on purpose — a pill row is its own boundary, so a
 * rule beneath it would draw a second one.
 */
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
  width = "full",
}: ContentLayoutProps) {
  const searchField = onSearchChange ? (
    <div className="relative w-full lg:w-64">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
      <Input
        placeholder={searchPlaceholder || "Search..."}
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-10 rounded-full border-card-border bg-card-bg pl-9 shadow-none"
      />
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "animate-in fade-in mx-auto w-full px-4 pb-5 pt-6 duration-300 md:px-8 md:pt-8",
        width === "bounded" && "max-w-6xl",
        className,
      )}
    >
      <header className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          {/* `min-w-0`, not `shrink-0`: a long description has to be able to
              wrap rather than push the controls off a narrower viewport. */}
          <div className="min-w-0 space-y-1">
            <h1 className="font-serif text-3xl text-foreground md:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-text-secondary">{description}</p>
            )}
          </div>

          {(actionButton || searchField) && (
            <div className="flex items-center gap-2 lg:flex-1 lg:justify-end">
              {/* Search first, action last: the primary action anchors the far
                  right of the header, which is where the eye ends. */}
              {searchField}
              {actionButton}
            </div>
          )}
        </div>

        {navigation && <nav>{navigation}</nav>}
      </header>

      <section className="pt-5">{children}</section>
    </div>
  );
}
