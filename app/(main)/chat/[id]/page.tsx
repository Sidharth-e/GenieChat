import { ChatConversation } from "@/components/chat/chat-conversation";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { store } from "@/lib/store";
import type { ThreadType } from "@/lib/types";

interface ChatPageProps {
    params: Promise<{ id: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
    const { id } = await params;
    let initialThreadType: ThreadType = "chat";
    let initialMessageCount = 0;

    const user = await getSessionUser();
    if (user) {
        const thread = await store.getThread(id);
        if (thread?.userId === user.id) {
            if (thread.threadType) {
                initialThreadType = thread.threadType;
            }
            initialMessageCount = thread.messageCount || 0;
        }
    }

    // Here you could fetch initial messages from your database
    // const initialMessages = await getMessages(id);

    return (
        <ChatConversation
            threadId={id}
            initialThreadType={initialThreadType}
            initialMessageCount={initialMessageCount}
        />
    );
}
