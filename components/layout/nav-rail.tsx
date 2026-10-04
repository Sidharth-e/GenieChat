"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Hammer, FolderOpen, NotebookTabs, type LucideIcon } from "lucide-react";
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
  HOME_ROUTE,
  RAIL_ITEMS,
  RAIL_HISTORY_ITEM,
  BUILD_ITEMS,
  isNavItemActive,
  type NavItem,
} from "@/constants/nav-routes";
import { AI_NAME } from "@/constants/main";
import { NotesModal } from "@/components/chat/notes-modal";
import { ThemeToggleButton } from "@/components/common/theme-toggle-button";
import { UserMenu } from "@/components/common/user-menu";

const TOOLTIP_CLASS =
  "bg-foreground text-background font-mono text-[10px] px-2 py-1 rounded-xs";
const FLYOUT_CLASS =
  "min-w-[180px] bg-dropdown-bg border-card-border p-1.5 rounded-sm shadow-xl z-50";

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          className={cn(
            "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors",
            isNavItemActive(pathname, item.href) && "bg-tertiary/8 text-foreground",
          )}
          aria-label={item.label}
        >
          <Icon className="w-5 h-5" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={14} className={TOOLTIP_CLASS}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}

function RailFlyout({
  triggerIcon: TriggerIcon,
  label,
  items,
  pathname,
}: {
  triggerIcon: LucideIcon;
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  const isActive = items.some((item) => isNavItemActive(pathname, item.href));

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "p-3 rounded-sm text-tertiary/40 hover:text-foreground transition-colors cursor-pointer",
                isActive && "bg-tertiary/8 text-foreground",
              )}
              aria-label={label}
            >
              <TriggerIcon className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={14} className={TOOLTIP_CLASS}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" sideOffset={14} className={FLYOUT_CLASS}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer",
                  isNavItemActive(pathname, item.href) && "bg-tertiary/8 font-medium",
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
  );
}

export function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const [isNotesOpen, setIsNotesOpen] = useState(false);

  useEffect(() => {
    const routesToPrefetch = Array.from(
      new Set(
        [...RAIL_ITEMS, RAIL_HISTORY_ITEM, ...BUILD_ITEMS].map(
          (item) => item.href,
        ),
      ),
    );
    routesToPrefetch.forEach((route) => router.prefetch(route));
  }, [router]);

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="w-16 shrink-0 border-r border-card-border bg-card-bg flex flex-col items-center py-4 z-40 relative h-screen">
        <Link
          href={HOME_ROUTE}
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
          {RAIL_ITEMS.map((item) => (
            <RailLink key={item.href} item={item} pathname={pathname} />
          ))}

          <RailFlyout
            triggerIcon={Hammer}
            label="Build"
            items={BUILD_ITEMS}
            pathname={pathname}
          />
          <RailLink item={RAIL_HISTORY_ITEM} pathname={pathname} />
        </nav>

        <div className="mt-auto flex flex-col gap-2 items-center">
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
            <TooltipContent side="right" sideOffset={14} className={TOOLTIP_CLASS}>
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
