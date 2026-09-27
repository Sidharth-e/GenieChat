import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Bot, Network } from "lucide-react";
import Link from "next/link";

interface WorkflowHeaderProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export function WorkflowHeader({
  searchQuery,
  setSearchQuery,
}: WorkflowHeaderProps) {
  return (
    <header className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-serif text-3xl text-foreground md:text-4xl">
          Pipelines & Workflows
        </h1>
        <p className="font-sans text-sm text-text-secondary">
          Chain agents and tools together for automated processing.
        </p>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-secondary" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 border-card-border bg-card-bg pl-9 shadow-none rounded-sm"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-10 shrink-0 bg-primary text-background px-4 py-2 text-sm font-medium rounded-sm hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer">
              <Plus className="h-4 w-4" />
              New workflow
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-dropdown-bg border-card-border p-1.5 rounded-sm shadow-xl z-50">
            <DropdownMenuItem asChild>
              <Link href="/workflow/new/agentic-workflow" className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer">
                <Bot className="h-4 w-4 text-tertiary/60" />
                <div>
                  <div className="font-medium">Agent Workflow</div>
                  <div className="text-[10px] text-text-secondary">
                    Multi-step agent pipeline
                  </div>
                </div>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/workflow/new/node-workflow"
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer"
              >
                <Network className="h-4 w-4 text-tertiary/60" />
                <div>
                  <div className="font-medium">Node Workflow</div>
                  <div className="text-[10px] text-text-secondary">
                    Visual node-based editor
                  </div>
                </div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
