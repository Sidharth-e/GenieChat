"use client";

import * as React from "react";
import { Message } from "@/lib/types";
import { MessageItem } from "./message-item";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useAgents } from "@/hooks/use-agents-queries";

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
}

export function MessageList({
  messages,
  isLoading,
  suggestions = [],
  onSuggestionClick,
}: MessageListProps) {
  const { data: allAgents = [] } = useAgents();
  const agentNames = React.useMemo(() => allAgents.map((a) => a.name), [allAgents]);

  const { scrollRef, bottomRef, scrollToBottom } =
    useAutoScroll<HTMLDivElement>(
      [messages.length, messages[messages.length - 1]?.content],
      { smooth: true },
    );

  // Initial scroll to bottom on mount if we have messages
  React.useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 min-h-[calc(100vh-200px)]">
        <div className="text-center space-y-5 max-w-3xl w-full">
          {/* Logo/Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-linear-to-br from-secondary to-secondary/80 flex items-center justify-center shadow-lg border border-tertiary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary border-2 border-secondary" />
            </div>
          </div>

          {/* Greeting */}
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-tertiary">
              How can I help you today?
            </h1>
          </div>

          {/* Suggestion Chips*/}
          {suggestions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => onSuggestionClick?.(suggestion)}
                  className={cn(
                    "group flex flex-col items-start gap-1 rounded-xl border border-tertiary/10 p-3 text-left",
                    "transition-all duration-200 hover:border-primary/50 hover:bg-tertiary/5",
                    "focus:outline-none focus:ring-2 focus:ring-primary/20",
                  )}
                >
                  <span className="text-sm font-medium text-tertiary line-clamp-2">
                    {suggestion}
                  </span>
                  <span className="text-xs text-tertiary/50 opacity-0 group-hover:opacity-100 transition-opacity">
                    Click to use this prompt
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 overflow-y-auto",
        "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-tertiary/10 hover:scrollbar-thumb-tertiary/20",
      )}
    >
      <div className="mx-auto max-w-3xl py-6 lg:pt-32">
        {messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            agentNames={agentNames}
            isStreaming={
              isLoading &&
              index === messages.length - 1 &&
              message.role === "assistant"
            }
          />
        ))}
      </div>
      <div ref={bottomRef} className="h-4" />
    </div>
  );
}
