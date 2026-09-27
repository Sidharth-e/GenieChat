import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { IframePreview } from "@/components/chat/iframe-preview";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-session-user";

interface PreviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PreviewPage({
  params,
  searchParams,
}: PreviewPageProps) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return notFound();
  }

  const resolvedSearchParams = await searchParams;
  const versionParam = resolvedSearchParams?.version;

  const store = new ChatHistoryStore();
  const thread = await store.getThread(id);
  if (!thread || thread.userId !== user.id) {
    return notFound();
  }

  const messages = await store.getMessages(id);

  if (!messages || messages.length === 0) {
    return notFound();
  }

  const extractedCodeBlocks: string[] = [];
  const seen = new Set<string>();
  const addBlock = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    extractedCodeBlocks.push(code);
  };
  const codeBlockRegex = /```(?:react-canvas|canvas)\n([\s\S]*?)```/g;

  messages.forEach((msg) => {
    if (msg.role !== "assistant") return;

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.name === "generate_canvas" && tc.result) {
          try {
            const parsed = JSON.parse(tc.result);
            if (parsed.react_canvas_code) {
              addBlock(parsed.react_canvas_code.trim().replace(/\n$/, ""));
            }
          } catch {}
        }
      }
    }

    if (msg.content) {
      let match;
      while ((match = codeBlockRegex.exec(msg.content)) !== null) {
        addBlock(match[1].trim().replace(/\n$/, ""));
      }
    }
  });

  if (extractedCodeBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#131314] text-white">
        <p>No valid react-canvas code found in this thread.</p>
      </div>
    );
  }

  let versionIndex = extractedCodeBlocks.length - 1;
  if (versionParam && typeof versionParam === "string") {
    const parsed = parseInt(versionParam, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed < extractedCodeBlocks.length) {
      versionIndex = parsed;
    }
  }

  const code = extractedCodeBlocks[versionIndex];

  return (
    <div className="w-full h-screen overflow-hidden bg-[#131314]">
      <IframePreview code={code} />
    </div>
  );
}
