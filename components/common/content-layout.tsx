"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ContentLayoutProps {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  
  // Search & Action Props
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actionButton?: React.ReactNode;
  
  // Optional navigation (e.g., tabs)
  navigation?: React.ReactNode;
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
}: ContentLayoutProps) {
  return (
    <div className={cn(
      "mx-auto w-full max-w-6xl px-4 pb-5 pt-14 md:px-8 md:pt-20 animate-in fade-in duration-300",
      className
    )}>
      <header className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="font-serif text-3xl text-foreground md:text-4xl">
            {title}
          </h1>
          <p className="text-sm text-text-secondary">
            {description}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {onSearchChange && (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-secondary" />
              <Input
                placeholder={searchPlaceholder || "Search..."}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-10 border-card-border bg-card-bg pl-9 shadow-none"
              />
            </div>
          )}
          {actionButton}
        </div>

        {navigation && (
          <nav className="border-b border-card-border">
            {navigation}
          </nav>
        )}
      </header>

      <section className="pt-5">
        {children}
      </section>
    </div>
  );
}
