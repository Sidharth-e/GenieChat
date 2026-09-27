import { NodeKind } from "@/lib/workflow/types";
import {
  BrainCircuit,
  Code,
  GitBranch,
  Globe,
  LayoutTemplate,
  LogIn,
  LogOut,
  StickyNote,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<NodeKind, { icon: React.ElementType; color: string }> = {
  [NodeKind.Input]: { icon: LogIn, color: "text-blue-500 bg-blue-500/10" },
  [NodeKind.Output]: { icon: LogOut, color: "text-green-500 bg-green-500/10" },
  [NodeKind.LLM]: { icon: BrainCircuit, color: "text-purple-500 bg-purple-500/10" },
  [NodeKind.Condition]: { icon: GitBranch, color: "text-orange-500 bg-orange-500/10" },
  [NodeKind.Tool]: { icon: Wrench, color: "text-cyan-500 bg-cyan-500/10" },
  [NodeKind.Http]: { icon: Globe, color: "text-red-500 bg-red-500/10" },
  [NodeKind.Template]: { icon: LayoutTemplate, color: "text-yellow-500 bg-yellow-500/10" },
  [NodeKind.Note]: { icon: StickyNote, color: "text-gray-500 bg-gray-500/10" },
  [NodeKind.Code]: { icon: Code, color: "text-emerald-500 bg-emerald-500/10" },
};

export function NodeIcon({
  type,
  className,
  iconClassName,
}: {
  type: NodeKind;
  className?: string;
  iconClassName?: string;
}) {
  const config = iconMap[type] || iconMap[NodeKind.Note];
  const Icon = config.icon;
  return (
    <div className={cn("p-1.5 rounded-lg", config.color, className)}>
      <Icon className={cn("w-3.5 h-3.5", iconClassName)} />
    </div>
  );
}
