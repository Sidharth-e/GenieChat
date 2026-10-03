import { ContentLayout } from "@/components/common/content-layout";
import { ScheduleForm } from "@/components/schedules/schedule-form";

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
      </ContentLayout>
    </div>
  );
}
