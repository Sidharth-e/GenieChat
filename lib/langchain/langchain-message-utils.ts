import "server-only";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { Message } from "../types";

type MultimodalContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } };

export interface MessageImageInput {
  base64Data: string;
  mimeType: string;
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content || typeof content !== "object") {
    return "";
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (!part || typeof part !== "object") {
          return "";
        }

        const partObj = part as Record<string, unknown>;
        if (typeof partObj.text === "string") {
          return partObj.text;
        }

        if (Array.isArray(partObj.content)) {
          return extractTextFromContent(partObj.content);
        }

        return "";
      })
      .filter(Boolean);

    return textParts.join("");
  }

  const contentObj = content as Record<string, unknown>;
  if (typeof contentObj.text === "string") {
    return contentObj.text;
  }

  if (Array.isArray(contentObj.content)) {
    return extractTextFromContent(contentObj.content);
  }

  return "";
}

export function filterValidMessages(messages: Message[]): Message[] {
  return messages.filter(
    (msg): msg is Message =>
      msg != null && typeof msg === "object" && !!msg.role && !!msg.content,
  );
}

export function convertToLangChainMessages(params: {
  messages: Message[];
  images?: MessageImageInput[];
}): BaseMessage[] {
  const { messages, images } = params;
  const langChainMessages: BaseMessage[] = [];

  const lastUserMessageIndex =
    messages
      .map((msg, idx) => (msg && msg.role === "user" ? idx : -1))
      .filter((idx) => idx !== -1)
      .pop() ?? -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !msg.role || !msg.content) {
      continue;
    }

    const safeContent = extractTextFromContent(msg.content);

    switch (msg.role) {
      case "user": {
        const isLastUserMessage = i === lastUserMessageIndex;
        if (isLastUserMessage && images && images.length > 0) {
          const content: MultimodalContentBlock[] = [];
          if (safeContent) {
            content.push({ type: "text", text: safeContent });
          }
          for (const image of images) {
            content.push({
              type: "image_url",
              image_url: {
                url: image.base64Data,
                detail: "high",
              },
            });
          }
          langChainMessages.push(new HumanMessage({ content }));
        } else if (safeContent) {
          langChainMessages.push(new HumanMessage(safeContent));
        }
        break;
      }
      case "assistant":
        if (safeContent) {
          langChainMessages.push(new AIMessage(safeContent));
        }
        break;
      case "system":
        if (safeContent) {
          langChainMessages.push(new SystemMessage(safeContent));
        }
        break;
      default:
        if (safeContent) {
          langChainMessages.push(new HumanMessage(safeContent));
        }
    }
  }

  return langChainMessages;
}
