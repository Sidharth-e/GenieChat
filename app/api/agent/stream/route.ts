import { NextRequest } from "next/server";
import { handleAgentStream } from "@/lib/api/stream/modes/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleAgentStream(req);
}
