"use client";

import { useParams } from "next/navigation";
import { WebhookForm } from "@/components/webhooks/webhook-form";

export default function EditWebhookPage() {
  const { id } = useParams<{ id: string }>();
  return <WebhookForm webhookId={id} />;
}
