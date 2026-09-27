"use client";

import * as React from "react";
import { Message, Thread } from "@/lib/types";
import { MessageItem } from "@/components/chat/message-item";
import { cn } from "@/lib/utils";
import { Share2, MessageSquare } from "lucide-react";
import { AI_NAME } from "@/constants/main";

interface ShareMessageListProps {
    thread: Thread;
    messages: Message[];
}

export function ShareMessageList({ thread, messages }: ShareMessageListProps) {
    return (
        <div className="min-h-screen bg-secondary">
            {/* Header */}
            <header className="sticky top-0 z-10 border-b border-tertiary/10 bg-secondary/95 backdrop-blur-sm">
                <div className="mx-auto max-w-3xl px-4 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                            <Share2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h1 className="text-lg font-semibold text-tertiary truncate">
                                {thread.title || "Shared Chat"}
                            </h1>
                            <p className="text-sm text-tertiary/50 flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                {messages.length} message{messages.length !== 1 && "s"}
                            </p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Messages */}
            <main
                className={cn(
                    "flex-1",
                    "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-tertiary/10 hover:scrollbar-thumb-tertiary/20"
                )}
            >
                <div className="mx-auto max-w-3xl py-6">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <MessageSquare className="h-12 w-12 text-tertiary/30 mb-4" />
                            <p className="text-tertiary/50">No messages in this conversation.</p>
                        </div>
                    ) : (
                        messages.map((message) => (
                            <MessageItem
                                key={message.id}
                                message={message}
                                name={AI_NAME}
                                isStreaming={false}
                            />
                        ))
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-tertiary/10 bg-secondary/95 backdrop-blur-sm py-4">
                <div className="mx-auto max-w-3xl px-4 text-center">
                    <p className="text-sm text-tertiary/50">
                        This is a shared conversation. You are viewing it in read-only mode.
                    </p>
                </div>
            </footer>
        </div>
    );
}
