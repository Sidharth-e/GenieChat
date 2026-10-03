import { ContentLayout } from "@/components/common/content-layout";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import type { TriggerTargetType } from "@/lib/types";

/**
 * The create route.
 *
 * The target can arrive in the query string, which is how the per-target block's
 * "New schedule" link opens a form already pointed at the agent you were looking
 * at. Both parameters are validated as *strings* here and the type is checked
 * against the union, so a hand-edited URL cannot select something unschedulable.
 */
export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ "target.type"?: string; "target.id"?: string }>;
}) {
  const params = await searchParams;
  const type = params["target.type"];
  const id = params["target.id"];

  const defaultTarget =
    id && (type === "agent" || type === "workflow" || type === "tool")
      ? { type: type as TriggerTargetType, id }
      : undefined;

  return (
    <div className="h-full w-full overflow-y-auto">
      <ContentLayout
        title="New schedule"
        description="Pick a target, say when it should run, and give it an input."
        width="bounded"
      >
        <ScheduleForm defaultTarget={defaultTarget} />
      </ContentLayout>
    </div>
  );
}
