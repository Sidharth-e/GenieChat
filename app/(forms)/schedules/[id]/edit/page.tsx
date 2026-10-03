import { ContentLayout } from "@/components/common/content-layout";
import { ScheduleForm } from "@/components/schedules/schedule-form";
import { ScheduleHistory } from "@/components/schedules/schedule-history";

export default async function EditSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="h-full w-full overflow-y-auto">
      <ContentLayout
        title="Edit schedule"
        description="Change when it runs, what it runs, or whether it runs at all."
        width="bounded"
      >
        <ScheduleForm scheduleId={id} />
        <div className="mt-8 border-t border-card-border pt-6">
          <ScheduleHistory scheduleId={id} />
        </div>
      </ContentLayout>
    </div>
  );
}
