import type { MouseEvent } from "react";
import {
  Power,
  PowerOff,
  Pen,
  Trash2,
  Globe,
  Radio,
  EllipsisVertical,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConnectorConfig } from "@/lib/types";

export const transportIcons = {
  http: Globe,
  sse: Radio,
};

interface ConnectorCardProps {
  server: ConnectorConfig;
  toolCount: number;
  isLoadingTools?: boolean;
  index?: number;
  onToggle: (e: MouseEvent) => void;
  onEdit: (e: MouseEvent) => void;
  onDelete: (e: MouseEvent) => void;
  onViewTools: () => void;
  isUsedInAgent?: boolean;
}

export function ConnectorCard({
  server,
  toolCount,
  isLoadingTools,
  onToggle,
  onEdit,
  onDelete,
  onViewTools,
  isUsedInAgent,
}: ConnectorCardProps) {
  const Icon = transportIcons[server.transportType] || Globe;
  const cannotDelete = isUsedInAgent;
  const cannotDisable = isUsedInAgent && server.enabled;

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onViewTools();
        }
      }}
      onClick={onViewTools}
      className={cn(
        "grid grid-cols-12 gap-4 p-4 border-b border-card-border items-center hover:bg-tertiary/5 transition-colors cursor-pointer last:border-b-0",
        !server.enabled && "opacity-60",
      )}
    >
      <div className="col-span-12 md:col-span-5 flex items-center gap-3 min-w-0">
        <Icon className="w-5 h-5 text-foreground shrink-0" />
        <div className="min-w-0 flex-1 truncate">
          <div className="font-sans text-sm font-medium text-foreground truncate">
            {server.name}
          </div>
          <div className="font-mono text-[10px] text-tertiary/40 truncate">
            {server.serverUrl || "mcp://local"}
          </div>
        </div>
      </div>

      <div className="col-span-6 md:col-span-3 flex items-center gap-2">
        {server.enabled ? (
          <>
            <div className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse" />
            <span className="font-mono text-xs text-[var(--green)]">Connected</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-[var(--red)]" />
            <span className="font-mono text-xs text-[var(--red)]">Disabled</span>
          </>
        )}
      </div>

      <div className="col-span-5 md:col-span-3 font-mono text-[10px] text-tertiary/50">
        {server.enabled && isLoadingTools ? (
          <span className="inline-flex items-center gap-1.5 text-tertiary/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading tools...
          </span>
        ) : (
          `${toolCount} Tools exported`
        )}
      </div>

      <div className="col-span-1 text-right flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1 rounded-sm text-tertiary/40 hover:text-foreground transition-colors cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Connector options"
            >
              <EllipsisVertical className="w-4 h-4 ml-auto" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 border-card-border bg-card-bg shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-xs"
              onClick={(e) => onEdit(e)}
            >
              <Pen className="h-3.5 w-3.5 text-tertiary/60" />
              Edit connector
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "cursor-pointer gap-2 text-xs",
                cannotDisable && "opacity-50",
              )}
              disabled={!!cannotDisable}
              onClick={(e) => {
                if (!cannotDisable) onToggle(e);
              }}
            >
              {server.enabled ? (
                <PowerOff className="h-3.5 w-3.5 text-tertiary/60" />
              ) : (
                <Power className="h-3.5 w-3.5 text-tertiary/60" />
              )}
              <div>
                <div>{server.enabled ? "Disable connector" : "Enable connector"}</div>
                {cannotDisable && (
                  <div className="text-[10px] text-tertiary/40">
                    Used in an agent
                  </div>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={cn(
                "cursor-pointer gap-2 text-xs text-[var(--red)] focus:text-[var(--red)]",
                cannotDelete && "opacity-50",
              )}
              disabled={!!cannotDelete}
              onClick={(e) => {
                if (!cannotDelete) onDelete(e);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <div>
                <div>Delete connector</div>
                {cannotDelete && (
                  <div className="text-[10px] text-tertiary/40">
                    Used in an agent
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
