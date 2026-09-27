import { clsx, type ClassValue } from "clsx";
import type { Message } from "./types";
import { twMerge } from "tailwind-merge";
import { v7 as uuidv7 } from "uuid";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Today";
  } else if (days === 1) {
    return "Yesterday";
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }
}

export function generateId(): string {
  return uuidv7();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Safely applies a specific MessageVersion's data to the root Message object.
 * Use this whenever a user navigates between message versions.
 */
export function applyMessageVersion(message: Message, versionIndex: number): Message {
  if (!message.versions || versionIndex < 0 || versionIndex >= message.versions.length) {
    return message;
  }

  const version = message.versions[versionIndex];

  return {
    ...message,
    activeVersionIndex: versionIndex,
    content: version.content,
    model: version.model,
    agentId: version.agentId,
    agentName: version.agentName,
    toolCalls: version.toolCalls,
    documents: version.documents,
    images: version.images,
    tokens: version.tokens,
    citations: version.citations,
    researchReport: version.researchReport,
  };
}
