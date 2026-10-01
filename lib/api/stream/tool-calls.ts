import { generateId } from "@/lib/utils";
import type { PersistedToolCall, TokenMeta } from "./events";

export interface ToolStartEvent {
  sourceId?: string;
  name: string;
  args: Record<string, unknown>;
  meta?: TokenMeta;
}

export interface ToolResultEvent {
  sourceId?: string;
  name?: string;
  meta?: TokenMeta;
}

export interface ToolStartResult {
  id: string;
  record: PersistedToolCall;
}

export interface ToolResultResolution {
  id?: string;
  /**
   * Set only when the tracker had to invent a call for a result it could not
   * match — the runner appends it so the persisted list stays consistent with
   * the `tool_result` frame already written to the wire.
   */
  record?: PersistedToolCall;
}

export interface ToolCallTracker {
  onStart(event: ToolStartEvent): ToolStartResult;
  onResult(event: ToolResultEvent): ToolResultResolution;
}

/**
 * chat — direct. chatService.streamChat already emits UI-stable ids, so a
 * result matches its start by id with no bookkeeping.
 */
export function createChatTracker(): ToolCallTracker {
  return {
    onStart(event) {
      const id = event.sourceId || generateId();
      return {
        id,
        record: {
          id,
          name: event.name,
          arguments: event.args,
          agentId: event.meta?.agentId,
          agentName: event.meta?.agentName,
        },
      };
    },
    onResult(event) {
      return { id: event.sourceId };
    },
  };
}

/**
 * agent — mapped. The service emits source ids that are not UI ids, so a start
 * mints a UI id into a map and queues it; a result resolves through the map and
 * otherwise consumes the oldest queued call. A result that matches nothing at
 * all still gets a call of its own, so the client never receives a
 * `tool_result` for an id it was never told about.
 */
export function createAgentTracker(): ToolCallTracker {
  const sourceToUi = new Map<string, string>();
  const pending: string[] = [];

  return {
    onStart(event) {
      const sourceId = event.sourceId || generateId();
      const id = sourceToUi.get(sourceId) || generateId();
      sourceToUi.set(sourceId, id);
      pending.push(id);
      return {
        id,
        record: { id, name: event.name, arguments: event.args },
      };
    },
    onResult(event) {
      let id = event.sourceId ? sourceToUi.get(event.sourceId) : undefined;
      if (!id) id = pending[0];

      let record: PersistedToolCall | undefined;
      if (!id) {
        id = generateId();
        record = {
          id,
          name: event.name || "unknown_tool",
          arguments: {},
        };
      }

      const index = pending.indexOf(id);
      if (index !== -1) pending.splice(index, 1);

      return { id, record };
    },
  };
}

/**
 * multi-agent — agent-scoped. Supervisor and sub-agent tool calls can share a
 * name, so identity is the event id first and a `name:agentId` legacy key
 * second. Matching on name alone would let one agent's result settle another's
 * call. An event id that was never seen is echoed back rather than dropped, so
 * the frame on the wire is unchanged either way.
 */
export function createMultiAgentTracker(): ToolCallTracker {
  const byEventId = new Map<string, string>();
  const byLegacyKey = new Map<string, string>();

  const legacyKey = (name: string, meta?: TokenMeta) =>
    `${name}:${meta?.agentId ?? "supervisor"}`;

  return {
    onStart(event) {
      const id = event.sourceId || generateId();
      if (event.sourceId) byEventId.set(event.sourceId, id);
      byLegacyKey.set(legacyKey(event.name, event.meta), id);

      return {
        id,
        record: {
          id,
          name: event.name,
          arguments: event.args,
          agentId: event.meta?.agentId,
          agentName: event.meta?.agentName,
        },
      };
    },
    onResult(event) {
      let id: string | undefined;
      let resolvedByEventId = false;

      if (event.sourceId) {
        id = byEventId.get(event.sourceId) || event.sourceId;
        byEventId.delete(event.sourceId);
        resolvedByEventId = true;
      }

      if (!id && event.name) {
        const key = legacyKey(event.name, event.meta);
        const matched = byLegacyKey.get(key);
        if (matched) {
          byLegacyKey.delete(key);
          id = matched;
        }
      }

      // Resolving by event id leaves any other alias for that id stale.
      if (id && resolvedByEventId) {
        for (const [key, value] of byLegacyKey) {
          if (value === id) {
            byLegacyKey.delete(key);
            break;
          }
        }
      }

      return { id };
    },
  };
}
