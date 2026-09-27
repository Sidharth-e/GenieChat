"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MarkdownRenderer, messageContentStyles } from "./markdown-renderer";
import { SourcesSection } from "@/components/chat/sources-section";
import { useTypewriter } from "@/hooks/use-typewriter";

interface MessageContentProps {
  content: string;
  isUser: boolean;
  isStreaming?: boolean;
  citations?: string[];
  agentNames?: string[];
}

function MessageContentBase({
  content,
  isUser,
  isStreaming,
  citations,
  agentNames,
}: MessageContentProps) {
  const displayContent = useTypewriter(content, !isUser && !!isStreaming);
  const visibleContent = isUser ? content : displayContent;

  return (
    <div className={messageContentStyles}>
      <AnimatePresence mode="wait">
        {visibleContent ? (
          <motion.div
            key="content"
            initial={isStreaming ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap wrap-break-words">
                {agentNames && agentNames.length > 0
                  ? (() => {
                      const escaped = agentNames
                        .map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
                        .sort((a, b) => b.length - a.length);
                      const regex = new RegExp(`(${escaped.join("|")})`, "gi");
                      return content.split(regex).map((part, i) => {
                        const isMatch = agentNames.some(
                          (n) => part.toLowerCase() === `@${n.toLowerCase()}`,
                        );
                        return isMatch ? (
                          <span
                            key={i}
                            className="text-primary bg-primary/10 rounded px-1 py-0.5 font-medium"
                          >
                            {part}
                          </span>
                        ) : (
                          part
                        );
                      });
                    })()
                  : content}
              </div>
            ) : (
              <>
                <MarkdownRenderer
                  content={displayContent}
                  citations={citations}
                  isStreaming={isStreaming}
                />
                {citations && citations.length > 0 && !isStreaming && (
                  <SourcesSection citations={citations} />
                )}
              </>
            )}
          </motion.div>
        ) : isStreaming ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <div className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-tertiary/30" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const MessageContent = React.memo(MessageContentBase);
