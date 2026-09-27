"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Search } from "lucide-react";

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    icon?: React.ReactNode;
    disabled?: boolean;
}

interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    id?: string;
    searchable?: boolean;
    size?: "sm" | "md";
}

export function Select({
    value,
    onChange,
    options,
    placeholder = "Select an option",
    className,
    disabled,
    id,
    searchable,
    size = "md",
}: SelectProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
    const [dropdownPos, setDropdownPos] = React.useState<{
        top: number;
        left: number;
        width: number;
    } | null>(null);
    const ref = React.useRef<HTMLDivElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);

    const showSearch = searchable ?? options.length > 6;

    const selectedOption = options.find((opt) => opt.value === value);

    const filtered = showSearch && search
        ? options.filter(
              (opt) =>
                  opt.label.toLowerCase().includes(search.toLowerCase()) ||
                  opt.value.toLowerCase().includes(search.toLowerCase())
          )
        : options;

    const updatePosition = React.useCallback(() => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = Math.min(filtered.length * 40 + (showSearch ? 48 : 8), 320);
        const openUpward = spaceBelow < dropdownHeight && rect.top > spaceBelow;

        setDropdownPos({
            top: openUpward ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
            left: rect.left,
            width: Math.max(rect.width, 200),
        });
    }, [filtered.length, showSearch]);

    const open = React.useCallback(() => {
        if (disabled) return;
        updatePosition();
        setIsOpen(true);
        setSearch("");
        setHighlightedIndex(-1);
    }, [disabled, updatePosition]);

    const close = React.useCallback(() => {
        setIsOpen(false);
        setSearch("");
        setHighlightedIndex(-1);
    }, []);

    React.useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (ref.current?.contains(target)) return;
            const portal = document.getElementById("select-portal");
            if (portal?.contains(target)) return;
            close();
        };
        const handleScroll = () => updatePosition();
        document.addEventListener("mousedown", handleClickOutside);
        window.addEventListener("scroll", handleScroll, true);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            window.removeEventListener("scroll", handleScroll, true);
        };
    }, [isOpen, close, updatePosition]);

    React.useEffect(() => {
        if (isOpen && showSearch) {
            requestAnimationFrame(() => searchRef.current?.focus());
        }
    }, [isOpen, showSearch]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
                e.preventDefault();
                open();
            }
            return;
        }

        switch (e.key) {
            case "Escape":
                e.preventDefault();
                close();
                break;
            case "ArrowDown":
                e.preventDefault();
                setHighlightedIndex((prev) => {
                    const next = prev < filtered.length - 1 ? prev + 1 : 0;
                    scrollToIndex(next);
                    return next;
                });
                break;
            case "ArrowUp":
                e.preventDefault();
                setHighlightedIndex((prev) => {
                    const next = prev > 0 ? prev - 1 : filtered.length - 1;
                    scrollToIndex(next);
                    return next;
                });
                break;
            case "Enter":
                e.preventDefault();
                if (highlightedIndex >= 0 && filtered[highlightedIndex] && !filtered[highlightedIndex].disabled) {
                    onChange(filtered[highlightedIndex].value);
                    close();
                }
                break;
        }
    };

    const scrollToIndex = (index: number) => {
        const list = listRef.current;
        if (!list) return;
        const item = list.children[index] as HTMLElement | undefined;
        item?.scrollIntoView({ block: "nearest" });
    };

    const heightCls = size === "sm" ? "h-8" : "h-10";
    const textCls = size === "sm" ? "text-xs" : "text-sm";

    const dropdown = isOpen && dropdownPos && (
        <div
            id="select-portal"
            style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownPos.width,
                zIndex: 9999,
            }}
        >
            <div className="overflow-hidden rounded-2xl border border-card-border bg-dropdown-bg shadow-md animate-in fade-in-0 zoom-in-95 duration-150">
                {showSearch && (
                    <div className="flex items-center gap-2 mx-2 mt-2 mb-1 px-2.5 py-1.5 rounded-lg border border-card-border/40">
                        <Search className={cn("shrink-0 text-text-secondary", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
                        <input
                            ref={searchRef}
                            type="text"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setHighlightedIndex(0);
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="Search..."
                            className={cn("h-5 w-full bg-transparent text-foreground placeholder:text-text-secondary/60 focus:outline-none shadow-none", textCls)}
                        />
                    </div>
                )}
                <div ref={listRef} className="max-h-[280px] overflow-y-auto p-1.5">
                    {filtered.length === 0 ? (
                        <div className={cn("px-3 py-6 text-center text-text-secondary", textCls)}>
                            No results
                        </div>
                    ) : (
                        filtered.map((option, idx) => (
                            <button
                                key={option.value}
                                type="button"
                                disabled={option.disabled}
                                onClick={() => {
                                    onChange(option.value);
                                    close();
                                }}
                                onMouseEnter={() => setHighlightedIndex(idx)}
                                className={cn(
                                    "flex w-full items-center rounded-lg transition-colors",
                                    size === "sm" ? "gap-2 px-2.5 py-1.5 text-xs" : "gap-3 px-3 py-2 text-sm",
                                    "disabled:opacity-40 disabled:cursor-not-allowed",
                                    idx === highlightedIndex && "bg-hover-bg",
                                    value === option.value &&
                                        "bg-primary/10 text-primary"
                                )}
                            >
                                {option.icon && (
                                    <span className="shrink-0">{option.icon}</span>
                                )}
                                <div className="flex flex-1 flex-col items-start min-w-0 text-left">
                                    <span title={option.label} className={cn("truncate w-full", size === "sm" ? "font-normal" : "font-medium")}>{option.label}</span>
                                    {option.description && (
                                        <span className="text-xs text-text-secondary">
                                            {option.description}
                                        </span>
                                    )}
                                </div>
                                {value === option.value && (
                                    <Check className={cn("shrink-0 text-primary", size === "sm" ? "h-3 w-3" : "h-4 w-4")} />
                                )}
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div ref={ref} className={cn("relative", className)}>
            <button
                type="button"
                id={id}
                onClick={() => (isOpen ? close() : open())}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border border-input-border bg-input-bg px-3 py-2 transition-all duration-200",
                    heightCls,
                    textCls,
                    "hover:border-primary/50 focus:outline-none",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                )}
            >
                <span title={selectedOption?.label} className={cn("flex items-center gap-2 truncate", !selectedOption && "text-text-secondary")}>
                    {selectedOption?.icon}
                    <span className="truncate">
                        {selectedOption?.label || placeholder}
                    </span>
                </span>
                <ChevronDown
                    className={cn(
                        "h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200",
                        isOpen && "rotate-180"
                    )}
                />
            </button>
            {typeof window !== "undefined" && createPortal(dropdown, document.body)}
        </div>
    );
}
