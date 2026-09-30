"use client";

import { Plus, Bot, Network } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The create action for the workflow list. A menu rather than a single button
 * because the two kinds are built in different editors, so neither is a
 * sensible default for the other.
 */
export function WorkflowCreateMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-10 rounded-full px-4 shadow-none hover:scale-100">
          <Plus className="h-4 w-4" />
          New workflow
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-dropdown-bg border-card-border p-1.5 rounded-sm shadow-xl z-50 w-56"
      >
        <DropdownMenuItem asChild>
          <Link
            href="/workflow/new/agentic-workflow"
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground hover:bg-tertiary/10 rounded-xs cursor-pointer"
          >
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
  );
}
