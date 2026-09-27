import { GitBranch, Plus } from "lucide-react";
import Link from "next/link";

export function WorkflowEmptyState() {
  return (
    <div className="rounded-sm border border-dashed border-card-border bg-card-bg p-12 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-sm bg-tertiary/5 text-foreground">
        <GitBranch className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-foreground">
        No workflows yet
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        Create your first workflow to automate agent tasks
      </p>
      <Link href="/workflow/new/agentic-workflow" className="inline-flex mt-4">
        <button className="bg-primary text-background px-4 py-2 text-sm font-medium rounded-sm hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer">
          <Plus className="h-4 w-4" />
          Create workflow
        </button>
      </Link>
    </div>
  );
}
