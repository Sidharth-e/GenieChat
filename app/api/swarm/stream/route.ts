import { NextRequest } from "next/server";
import { handleSwarmStream } from "@/lib/api/stream/modes/swarm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleSwarmStream(req);
}
