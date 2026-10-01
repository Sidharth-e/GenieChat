import { NextRequest } from "next/server";
import { handleMultiAgentStream } from "@/lib/api/stream/modes/multi-agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleMultiAgentStream(req);
}
