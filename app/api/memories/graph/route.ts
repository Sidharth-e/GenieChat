import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/lib/auth/get-session-user";
import { MemoryGraphStore } from "@/lib/memory/graph-store";
import { buildMemoryGraphView } from "@/lib/memory/graph-view";
import { api } from "@/lib/api-utils";

const memoryStore = new MemoryGraphStore();

/**
 * The whole drawn graph for the signed-in user.
 *
 * The store has already filtered on `userId`, and the window is capped inside
 * it, so this route's only job is to assemble what it read and hand it over.
 * The assembly is a pure function rather than something done here, which is
 * what lets the interesting decisions be tested without a browser or a server.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return api.unauthorized();

    const { rows, totalMemories } = await memoryStore.getMemoryGraph(user.id);
    return NextResponse.json(buildMemoryGraphView(rows, totalMemories));
  } catch (error) {
    // An unconfigured or unreachable Neo4j surfaces here as a 500, not as an
    // empty graph: the graph *is* the page, so "you have no memories" would be
    // a lie the reader has no way to detect.
    logger.error({ err: error }, "Error building memory graph");
    return api.serverError("Failed to build memory graph");
  }
}
