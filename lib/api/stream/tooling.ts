import { resolveMCPServerSecrets } from "@/lib/mcp/resolve-mcp-secrets";
import type { MCPServerConfig } from "@/lib/types";

/**
 * Pure tooling helpers, kept out of `context.ts` on purpose.
 *
 * `context.ts` constructs the MongoDB stores, so importing it pulls in
 * `@/lib/mongodb/client` → `@/lib/config` → `@/lib/env`, which parses
 * `process.env` at module load. That makes anything reachable from it
 * untestable without a full environment. This module imports neither config nor
 * env — the same split `lib/storage/ref.ts` keeps from `s3-client.ts` — so the
 * branches below are covered by `tests/lib/api/stream/context.test.ts`.
 */

/** Moved here from the three route files, which each carried a verbatim copy. */
export function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * agent keeps only the custom tools its own record names; multi-agent and swarm
 * load every enabled tool and index it under all of its aliases, so a
 * supervisor or a swarm member can reference one by any spelling.
 */
export type CustomToolSelection = "allowed-only" | "all-enabled";

/**
 * One algorithm, four callers — agent passes its own tools, multi-agent the
 * union of main-agent and sub-agent tools, swarm the union of its members', and
 * chat sets `includeAllEnabled` because it has no agent record to name tools
 * with at all.
 *
 * An empty tool list means no servers at all: every agent-driven caller
 * initialises `mcpServers` to `[]` and none of them rescues it. A tool list
 * where no entry carries a `<server>:` prefix means every enabled server, which
 * is how a mode that names tools without server scoping keeps working.
 */
export function filterMcpServers(params: {
  allServers: MCPServerConfig[];
  secretMap: Record<string, string>;
  allowedTools?: string[];
  extraRequiredTools?: string[];
  /**
   * Bind every enabled server without naming one. Default chat is the only
   * caller: an agent's `tools` list is what scopes MCP servers on the agent,
   * multi-agent and swarm surfaces, and chat has no agent — so there is no list
   * to narrow with, and "no list means no servers" would leave a user's
   * configured servers unreachable in the one surface with no configuration of
   * its own. Disabled servers are still dropped.
   */
  includeAllEnabled?: boolean;
}): MCPServerConfig[] {
  const enabled = params.allServers.filter((s) => s.enabled);

  if (params.includeAllEnabled) {
    return resolveMCPServerSecrets(enabled, params.secretMap);
  }

  const required = new Set([
    ...(params.allowedTools ?? []),
    ...(params.extraRequiredTools ?? []),
  ]);

  if (required.size === 0) return [];

  const serverNames = new Set(
    [...required]
      .map((t) => (t.includes(":") ? t.split(":")[0] : null))
      .filter((name): name is string => Boolean(name)),
  );

  const kept =
    serverNames.size > 0
      ? enabled.filter((s) => serverNames.has(s.name))
      : enabled;

  return resolveMCPServerSecrets(kept, params.secretMap);
}
