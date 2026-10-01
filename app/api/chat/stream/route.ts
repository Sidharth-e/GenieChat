import { NextRequest } from "next/server";
import { handleChatStream } from "@/lib/api/stream/modes/chat";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleChatStream(req);
}
