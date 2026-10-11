import { WebhookList } from "@/components/webhooks/webhook-list";

export default function WebhooksPage() {
  return (
    <div className="h-full w-full overflow-y-auto">
      <WebhookList />
    </div>
  );
}
