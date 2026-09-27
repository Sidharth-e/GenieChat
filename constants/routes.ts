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
  FileText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Thread } from "@/lib/types";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

export const RAIL_ITEMS: NavItem[] = [
  { href: "/chat/new", icon: LayoutGrid, label: "Home" },
  { href: "/agents", icon: Cpu, label: "Agents" },
  { href: "/mcp", icon: Plug, label: "MCP" },
  { href: "/workflow", icon: GitMerge, label: "Workflows" },
  { href: "/chat/history", icon: History, label: "History" },
];

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
  return latest ? getThreadRoute(latest) : "/chat/new";
}
