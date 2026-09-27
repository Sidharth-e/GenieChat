import { Variable, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface VariableMentionItemProps {
  nodeName?: string;
  path: string[];
  type?: string;
  notFound?: boolean;
  className?: string;
  onRemove?: () => void;
}

export function VariableMentionItem({
  nodeName,
  path,
  type,
  notFound,
  className,
  onRemove,
}: VariableMentionItemProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded-md",
        notFound && "bg-red-500/10 border-red-500/20",
        className,
      )}
    >
      <Variable className="size-3 text-primary shrink-0" />
      <span className="font-medium truncate">{nodeName}</span>
      <span className="text-primary truncate">{path.join(".")}</span>
      {type && <span className="text-tertiary/50">{type}</span>}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 hover:text-red-500 shrink-0">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
