
import type { RichWorkflow } from "@/lib/types";
import { WorkflowListItem } from "./workflow-list-item";

interface WorkflowListProps {
    workflows: RichWorkflow[];
    onExecute: (workflow: RichWorkflow) => void;
    onDelete: (workflowId: string) => void;
}

export function WorkflowList({
    workflows,
    onExecute,
    onDelete,
}: WorkflowListProps) {
    if (workflows.length === 0) return null;

    return (
        <div className="flex flex-col gap-3">
            {workflows.map((workflow) => (
                <WorkflowListItem
                    key={workflow.id}
                    workflow={workflow}
                    onExecute={onExecute}
                    onDelete={onDelete}
                />
            ))}
        </div>
    );
}
