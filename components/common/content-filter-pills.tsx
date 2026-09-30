"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ContentFilterPill<T extends string = string> {
  value: T;
  label: string;
  /** Optional leading glyph. Sizing is applied here, so pass the bare icon. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional trailing tally, e.g. the number of rows behind a filter. */
  count?: number;
}

interface ContentFilterPillsProps<T extends string> {
  /** Names the group for assistive tech, e.g. "Filter artifacts by type". */
  ariaLabel: string;
  options: readonly ContentFilterPill<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * The single filter strip every list page uses — the row of pills under the
 * title. It is deliberately borderless: the pill itself is the boundary, so a
 * rule under the row would draw a second one.
 *
 * Generic over the value union so a page can keep its own narrow tab type
 * (`AgentTab`, `MemoriesView`, `Role | "all"`) and still get `onChange` typed.
 */
export function ContentFilterPills<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: ContentFilterPillsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="hide-scrollbar flex gap-1 overflow-x-auto pb-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "text-text-secondary hover:bg-hover-bg hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
            {typeof option.count === "number" && (
              <span className="text-xs opacity-60">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
