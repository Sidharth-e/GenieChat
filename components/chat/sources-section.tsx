"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { ExternalLink, ChevronDown, ChevronUp, Globe } from "lucide-react";

interface SourcesSectionProps {
    citations: string[];
    className?: string;
}

/**
 * Extracts domain and favicon from a URL
 */
function getDomainInfo(url: string): { domain: string; favicon: string } {
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace(/^www\./, "");
        const favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        return { domain, favicon };
    } catch {
        return { domain: url, favicon: "" };
    }
}

export function SourcesSection({ citations, className }: SourcesSectionProps) {
    const [isExpanded, setIsExpanded] = React.useState(false);

    if (!citations || citations.length === 0) {
        return null;
    }

    // Show first 4 sources initially, rest in expandable section
    const visibleCount = 4;
    const visibleSources = citations.slice(0, visibleCount);
    const hiddenSources = citations.slice(visibleCount);
    const hasMore = hiddenSources.length > 0;

    const renderSourceItem = (url: string, index: number, totalIndex: number) => {
        const { domain, favicon } = getDomainInfo(url);

        return (
            <a
                key={index}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                    "group flex items-center gap-1.5 px-2.5 h-7 rounded-md", // Fixed height h-7 (28px)
                    "bg-background border border-border/60",
                    "hover:bg-hover-bg/50 hover:border-border",
                    "transition-all duration-200 ease-in-out",
                    "max-w-[160px] no-underline" // Ensure no-underline in case of prose
                )}
                title={url}
            >
                {/* Number Badge */}
                <span className="text-[10px] font-medium text-muted-foreground/60 shrink-0">
                    {totalIndex + 1}.
                </span>

                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
                    {favicon ? (
                        <Image
                            src={favicon}
                            alt=""
                            width={12}
                            height={12}
                            className="w-3 h-3 rounded-[2px] object-cover opacity-80 group-hover:opacity-100 transition-opacity shrink-0"
                            unoptimized
                            onError={(e) => {
                                e.currentTarget.style.display = "none";
                                e.currentTarget.nextElementSibling?.classList.remove("hidden");
                            }}
                        />
                    ) : null}
                    <Globe className={cn("w-3 h-3 text-muted-foreground/50 hidden shrink-0", !favicon && "block")} />

                    <span className="text-[11px] font-medium text-foreground/80 group-hover:text-foreground truncate transition-colors leading-none">
                        {domain}
                    </span>
                </div>

                <ExternalLink className="w-2.5 h-2.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-all shrink-0" />
            </a>
        );
    };

    return (
        <div className={cn("mt-3 flex flex-col gap-2", className)}>
            {/* Header - kept very subtle */}
            <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">
                    Sources
                </span>
            </div>

            <div className="flex flex-wrap gap-2">
                {visibleSources.map((url, index) => renderSourceItem(url, index, index))}

                {hasMore && !isExpanded && (
                    <button
                        onClick={() => setIsExpanded(true)}
                        className={cn(
                            "flex items-center gap-1 px-2 h-7 rounded-md",
                            "bg-background border border-border/60",
                            "text-[10px] font-medium text-muted-foreground/70 hover:text-foreground",
                            "hover:bg-hover-bg/50 transition-all"
                        )}
                    >
                        +{hiddenSources.length} more
                        <ChevronDown className="w-3 h-3" />
                    </button>
                )}
            </div>

            {hasMore && (
                <div
                    className={cn(
                        "flex flex-wrap gap-2",
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        isExpanded ? "opacity-100 max-h-[500px] mt-0" : "opacity-0 max-h-0 mt-0"
                    )}
                >
                    {hiddenSources.map((url, index) => renderSourceItem(url, index, visibleCount + index))}

                    {isExpanded && (
                        <button
                            onClick={() => setIsExpanded(false)}
                            className={cn(
                                "flex items-center gap-1 px-2 h-7 rounded-md",
                                "bg-background border border-border/60",
                                "text-[10px] font-medium text-muted-foreground/70 hover:text-foreground",
                                "hover:bg-hover-bg/50 transition-all"
                            )}
                        >
                            Show less
                            <ChevronUp className="w-3 h-3" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
