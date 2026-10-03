import "server-only";

import { createHash } from "node:crypto";
import { toSVG } from "bwip-js/node";

import {
  buildScancodeOptions,
  extractScancodeFences,
  parseScancodeConfig,
  scancodeTitle,
  withIntrinsicSize,
} from "@/lib/scancode";
import { ArtifactStore } from "@/lib/mongodb/artifact-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { logger } from "@/lib/logger";
import { saveToolArtifact } from "./save";

const artifactStore = isDatabaseConfigured() ? new ArtifactStore() : null;

function contentHash(svg: string): string {
  return createHash("sha256").update(svg).digest("hex").slice(0, 16);
}

/**
 * Saves every scan code a finished assistant message contains.
 *
 * The symbol is **re-encoded here** from the fence's JSON rather than taken from
 * the client. The bytes that reach storage are therefore produced by our own
 * encoder from a validated config, never markup the model wrote — which is what
 * keeps a stored SVG from being a script vector, and what makes the stored file
 * independent of whether anyone had the card open.
 *
 * A fence the encoder rejects is skipped rather than saved: the reader already
 * sees an error card for it, and a symbol that cannot be drawn must not become
 * an artifact that cannot be scanned.
 *
 * Cannot throw. It runs detached at the end of a stream, where a storage outage
 * must not affect a reply the user has already received.
 */
export async function saveScancodeArtifacts(
  userId: string,
  text: string,
  chatId: string,
): Promise<void> {
  const bodies = extractScancodeFences(text);
  if (bodies.length === 0 || !artifactStore) {
    return;
  }

  let existing: Set<string>;
  try {
    existing = await artifactStore.getScancodeHashes(userId, chatId);
  } catch (error) {
    // A failed read costs a duplicate, not a lost artifact, so it is not fatal.
    logger.error({ err: error }, "[Scancode] Failed to read saved scan codes");
    existing = new Set();
  }

  const seen = new Set<string>();

  for (const body of bodies) {
    const config = parseScancodeConfig(body);
    if (!config) {
      logger.warn("[Scancode] Skipped a fence that is not a usable config");
      continue;
    }

    let svg: string;
    try {
      svg = withIntrinsicSize(toSVG(buildScancodeOptions(config)));
    } catch (error) {
      logger.warn(
        { err: error },
        "[Scancode] Skipped a fence the encoder rejected",
      );
      continue;
    }

    // `seen` covers a message that emits the same symbol twice; `existing`
    // covers a regenerate of a message that already saved it.
    const hash = contentHash(svg);
    if (seen.has(hash) || existing.has(hash)) {
      continue;
    }
    seen.add(hash);

    await saveToolArtifact(
      userId,
      {
        type: "scancode",
        title: scancodeTitle(config),
        content: svg,
        ext: "svg",
        metadata: { scancodeHash: hash, format: config.format },
      },
      chatId,
    );
  }
}
