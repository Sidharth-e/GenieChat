"use client";

import * as React from "react";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { HomeChatInterface } from "@/components/chat/home-chat-interface";
import { usePendingMessageStore } from "@/lib/stores";
import { NEW_CHAT_PENDING_KEY } from "@/lib/stores/pending-message";

export function NewChatPageClient() {
  const pendingMessage = usePendingMessageStore(
    (state) => state.pendingMessages[NEW_CHAT_PENDING_KEY] ?? null,
  );
  const [showConversation, setShowConversation] = React.useState(
    () => pendingMessage != null,
  );
  const [latchedPendingMessage, setLatchedPendingMessage] = React.useState(
    () => pendingMessage,
  );

  React.useEffect(() => {
    if (pendingMessage) {
      setShowConversation(true);
      setLatchedPendingMessage(pendingMessage);
    }
  }, [pendingMessage]);

  if (!showConversation) {
    return <HomeChatInterface />;
  }

  return (
    <ChatConversation
      threadId={NEW_CHAT_PENDING_KEY}
      initialThreadType={latchedPendingMessage?.isResearch ? "research" : "chat"}
      initialMessageCount={0}
    />
  );
}
