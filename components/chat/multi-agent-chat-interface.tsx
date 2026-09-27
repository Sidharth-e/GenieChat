"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput } from "./chat-input";
import { Agent, ChatAttachment } from "@/lib/types";
import { usePendingMessageStore } from "@/lib/stores";
import { Bot, Users } from "lucide-react";
import { generateId } from "@/lib/utils";

interface AgentChatInterfaceProps {
  agent: Agent;
}

export function MultiAgentChatInterface({ agent }: AgentChatInterfaceProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading] = useState(false);
  const setPendingMessage = usePendingMessageStore(
    (state) => state.setPendingMessage,
  );

  const handleSubmit = async (attachments: ChatAttachment[] = []) => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const messageContent = input.trim();
    const nextThreadId = generateId();

    setPendingMessage(nextThreadId, messageContent, attachments);
    setInput("");
    router.push(`/multi-agent-chat/${agent.id}/${nextThreadId}`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Main Content - Agent Welcome Screen */}
      <main className="flex-1 flex flex-col items-center justify-center overflow-y-hidden px-4 py-8 sm:py-12">
        <div className="text-center space-y-8 max-w-3xl w-full">
          {/* Agent Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-primary flex items-center justify-center shadow-lg transform rotate-3 transition-transform hover:rotate-0 duration-300">
                <Users className="h-10 w-10 text-background" />
              </div>
              <div className="absolute -top-2 -left-2 h-8 w-8 rounded-xl bg-primary flex items-center justify-center shadow-md transform -rotate-6">
                <Bot className="h-5 w-5 text-background" />
              </div>
            </div>
          </div>

          {/* Agent Info */}
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-foreground flex items-center justify-center gap-2">
              {agent.name}{" "}
              <span className="text-text-secondary font-light">+ Team</span>
            </h1>
            <p className="mx-auto max-w-md line-clamp-2 text-text-secondary">
              {agent.description}
            </p>
            <p className="text-xs text-primary font-medium">
              {agent.subAgents?.length || 0} sub-agents ready to collaborate
            </p>
          </div>

          {/* Quick Tips */}
          <div className="flex flex-wrap justify-center gap-2">
            {agent.subAgents?.map((sa) => (
              <span
                key={sa.id}
                className="px-3 py-1.5 text-xs font-medium rounded-full bg-primary/10 text-primary border border-primary/20"
              >
                {sa.name}
              </span>
            ))}
          </div>
        </div>
      </main>

      {/* Input Area */}
      <div className="px-3 sm:px-4 pb-4 sm:pb-6 pt-2">
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={(attachments) => handleSubmit(attachments)}
          isLoading={isLoading}
          placeholder={`Message ${agent.name} and team...`}
          contextKey={`multi-agent-${agent.id}`}
        />
        {/* <p className="mt-3 text-center text-xs text-text-secondary">
          Chatting with {agent.name} & Co. AI can make mistakes.
        </p> */}
      </div>
    </div>
  );
}
