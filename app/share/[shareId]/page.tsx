import { logger } from "@/lib/logger";
import { ShareMessageList } from "@/components/share/share-message-list";
import { AlertCircle, Lock } from "lucide-react";
import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { Message } from "@/lib/types";
import Link from "next/link";

interface SharePageProps {
    params: Promise<{ shareId: string }>;
}

export default async function SharePage({ params }: SharePageProps) {
    const { shareId } = await params;

    let thread = null;
    let messages: Message[] = [];
    let accessDenied = false;

    try {
        const store = new ChatHistoryStore();
        const shareResult = await store.getThreadByShareIdWithAccess(shareId);
        thread = shareResult.thread;
        accessDenied = shareResult.accessDenied;

        if (thread && !accessDenied) {
            messages = await store.getMessages(thread.id);
        }
    } catch (error) {
        logger.error("Error fetching shared thread:", error);
    }

    // Access denied page
    if (accessDenied && thread) {
        return (
            <div className="min-h-screen bg-secondary flex items-center justify-center">
                <div className="text-center space-y-4 px-4 max-w-md">
                    <div className="flex justify-center">
                        <div className="h-16 w-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                            <Lock className="h-8 w-8 text-amber-500" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-semibold text-tertiary">
                        Access Restricted
                    </h1>
                    <p className="text-tertiary/60">
                        This conversation has been shared with specific users or groups only. 
                        You don&apos;t have permission to view this content.
                    </p>
                    <div className="pt-4">
                        <Link 
                            href="/login"
                            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            Sign in with a different account
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // Thread not found page
    if (!thread) {
        return (
            <div className="min-h-screen bg-secondary flex items-center justify-center">
                <div className="text-center space-y-4 px-4">
                    <div className="flex justify-center">
                        <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <AlertCircle className="h-8 w-8 text-primary" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-semibold text-tertiary">
                        Shared Chat Not Found
                    </h1>
                    <p className="text-tertiary/60 max-w-md">
                        This shared conversation may have been removed or the link is invalid.
                    </p>
                </div>
            </div>
        );
    }

    return <ShareMessageList thread={thread} messages={messages} />;
}

export const metadata = {
    title: "Shared Conversation",
    description: "View a shared conversation",
};
