import {
  LayoutGrid,
  Cpu,
  Plug,
  GitMerge,
  History,
  Zap,
  Book,
  Wrench,
  Webhook,
  FileBox,
  Brain,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Thread } from "@/lib/types";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

/** The canvas a fresh conversation starts on — the rail logo and the empty-canvas fallback both point here. */
export const HOME_ROUTE = "/chat/new";

/** Whether a rail or flyout entry owns the current path, matching nested routes but not sibling prefixes. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const RAIL_ITEMS: NavItem[] = [
  { href: HOME_ROUTE, icon: LayoutGrid, label: "Home" },
  { href: "/agents", icon: Cpu, label: "Agents" },
  { href: "/connectors", icon: Plug, label: "Connectors" },
  { href: "/workflow", icon: GitMerge, label: "Workflows" },
];

/** Rendered last on the rail, below the flyout groups. */
export const RAIL_HISTORY_ITEM: NavItem = {
  href: "/chat/history",
  icon: History,
  label: "History",
};

export const BUILD_ITEMS: NavItem[] = [
  { href: "/auto", icon: Zap, label: "Auto" },
  { href: "/prompts", icon: Book, label: "Prompts" },
  { href: "/tools", icon: Wrench, label: "Tools" },
  { href: "/webhooks", icon: Webhook, label: "Webhooks" },
];

export const LIBRARY_ITEMS: NavItem[] = [
  { href: "/artifacts", icon: FileBox, label: "Artifacts" },
  { href: "/memories", icon: Brain, label: "Memories" },
];

export const ADMIN_NAV_ITEM: NavItem = {
  href: "/admin",
  icon: ShieldCheck,
  label: "Admin",
};

export type ThreadRouteInput = Pick<Thread, "id"> & Partial<Pick<Thread, "agentId" | "isMultiAgent" | "isSwarm">>;

export function getThreadRoute(thread: ThreadRouteInput): string {
  if (thread.isSwarm) return `/swarm-chat/${thread.id}`;
  if (thread.agentId) {
    if (thread.isMultiAgent) return `/multi-agent-chat/${thread.agentId}/${thread.id}`;
    return `/agent-chat/${thread.agentId}/${thread.id}`;
  }
  return `/chat/${thread.id}`;
}

export function getCanvasRoute(threads?: ThreadRouteInput[]): string {
  const latest = threads?.[0];
  return latest ? getThreadRoute(latest) : HOME_ROUTE;
}
