import "server-only";
import { agentService } from "@/lib/langchain/agent-service";
import { DEFAULT_MODEL_ID } from "@/lib/langchain/model-config";
import { AgentStore } from "@/lib/mongodb/agent-store";
import { ChatHistoryStore } from "@/lib/mongodb/chat-history-store";
import { isDatabaseConfigured } from "@/lib/mongodb/client";
import { ConnectorStore } from "@/lib/mongodb/connector-store";
import { SecretStore } from "@/lib/mongodb/secret-store";
import { resolveConnectorSecrets } from "@/lib/connectors/resolve-connector-secrets";
import { generateId } from "@/lib/utils";
import type { Message, ToolSecret } from "@/lib/types";

const agentStore = isDatabaseConfigured() ? new AgentStore() : null;
const connectorStore = isDatabaseConfigured() ? new ConnectorStore() : null;
const secretStore = isDatabaseConfigured() ? new SecretStore() : null;
const chatHistoryStore = isDatabaseConfigured() ? new ChatHistoryStore() : null;

/** How much of the reply is kept on the run record. Enough to see what happened, short enough to store on every run. */
const OUTPUT_PREVIEW_LENGTH = 500;

export interface AgentRunOptions {
  userId: string;
  agentId: string;
  message: string;
  /**
   * Called once the thread exists and the model is about to be asked.
   *
   * This is a callback rather than something the caller reads off the result,
   * because both callers write it *before* the model call: the webhook stamps
   * `executionId` on the invocation so a slow run is visible while it runs, and a
   * result object only exists when the run is already over.
   */
  onStarted?: (threadId: string) => Promise<void>;
}

export interface AgentRunResult {
  threadId: string;
  outputPreview: string;
}

async function loadUserSecrets(
  userId: string,
): Promise<Record<string, string>> {
  if (!secretStore) return {};
  const secrets = await secretStore.getSecrets(userId);
  return secrets.reduce(
    (acc: Record<string, string>, s: ToolSecret) => {
      acc[s.name] = s.value;
      return acc;
    },
    {},
  );
}

/**
 * A minimal `Message` for `agentService.streamAgent`.
 *
 * `threadId` is empty on purpose: the stream is given the conversation as it
 * stands, and the store is what assigns the real thread id when the turns are
 * persisted below.
 */
export function buildUserMessage(content: string, userId: string): Message {
  const now = new Date().toISOString();
  const id = generateId();
  return {
    id,
    threadId: "",
    userId,
    userName: "",
    userEmail: "",
    role: "user",
    content,
    versions: [{ versionId: id, content, createdAt: now }],
    activeVersionIndex: 0,
    createdAt: now,
  };
}

/**
 * Runs one agent with no session behind it, and returns where it went.
 *
 * Extracted from the webhook executor, which had the only such run in the code
 * base. Two callers now share it -- a webhook invocation and a scheduled run --
 * and they differ only in what they do around it: a webhook stamps an invocation
 * row, a schedule settles a run record.
 *
 * The ownership check is here and not left to the store, because
 * `getAgent(agentId, userId?)` ignores its `userId` argument -- an agent's `_id`
 * is a globally unique uuidv7, so the read is by id alone and the store has no
 * boundary to enforce. A caller that skipped it would run somebody else's agent
 * and bill them for it. It throws `unauthorized` rather than returning a result,
 * so a caller that forgot cannot mistake a refusal for a successful empty run.
 */
export async function runAgentTarget(
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  if (!agentStore || !connectorStore || !chatHistoryStore) {
    throw new Error("Database not configured");
  }

  const agent = await agentStore.getAgent(options.agentId);
  if (!agent) {
    throw Object.assign(new Error(`Agent ${options.agentId} not found`), {
      code: "target_not_found",
    });
  }
  if (agent.userId !== options.userId) {
    throw Object.assign(new Error("Agent belongs to another user"), {
      code: "unauthorized",
    });
  }

  const modelId = agent.modelId || DEFAULT_MODEL_ID;

  // `agent-api` is the closest existing `ThreadType` for a run with no interactive
  // session. Adding a `schedule` member would mean touching the union's every
  // consumer for a label the thread list does not distinguish today.
  const thread = await chatHistoryStore.createThread(
    options.userId,
    modelId,
    agent.id,
    false,
    "agent-api",
  );

  if (options.onStarted) await options.onStarted(thread.id);

  const allConnectors = await connectorStore.getConnectors(options.userId);
  const enabledConnectors = allConnectors.filter((s) => s.enabled);
  const secretMap = await loadUserSecrets(options.userId);
  const resolvedConnectors = resolveConnectorSecrets(
    enabledConnectors,
    secretMap,
  );

  const systemPrompt =
    agent.systemPrompt || `You are ${agent.name}. ${agent.description}`;

  const stream = agentService.streamAgent({
    messages: [buildUserMessage(options.message, options.userId)],
    modelId,
    systemPrompt,
    connectors: resolvedConnectors,
    allowedTools: agent.tools,
  });

  let assistantContent = "";
  for await (const event of stream) {
    if (event.type === "token" && event.content) {
      assistantContent += event.content;
    }
  }

  await chatHistoryStore.addMessage(thread.id, {
    role: "user",
    content: options.message,
    userId: options.userId,
    threadId: thread.id,
    model: modelId,
  });

  if (assistantContent) {
    await chatHistoryStore.addMessage(thread.id, {
      role: "assistant",
      content: assistantContent,
      userId: options.userId,
      threadId: thread.id,
      model: modelId,
    });
  }

  return {
    threadId: thread.id,
    outputPreview: assistantContent.slice(0, OUTPUT_PREVIEW_LENGTH),
  };
}
