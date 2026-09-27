import { MongoClient, Db, Collection } from "mongodb";
import {
  uri,
  databaseName,
  historyCollectionName,
  threadCollectionName,
  agentCollectionName,
  promptCollectionName,
  mcpServerCollectionName,
  configCollectionName,
  logCollectionName,
  workflowCollectionName,
  workflowExecutionCollectionName,
  toolCollectionName,
  documentCollectionName,
  deepResearchCollectionName,
  memoriesCollectionName,
  notesCollectionName,
  usersCollectionName,
  autoTasksCollectionName,
  artifactsCollectionName,
  webhooksCollectionName,
} from "./config";
import { isDatabaseConfigured } from "@/lib/config";
import type {
  WithMongoId,
  ThreadDocument,
  MessageDocument,
  AgentDocument,
  PromptDocument,
  MCPServerDocument,
  ConfigDocument,
  LogDocument,
  WorkflowDocument,
  WorkflowExecutionDocument,
  CustomToolDocument,
  ChatDocument,
  DeepResearchReportDocument,
  MemoryDocument,
  NotesDocument,
  UserDocument,
  AutoTaskDocument,
  ArtifactDocument,
  WebhookDocument,
  WebhookInvocationDocument,
  ChatCitationDocument,
  AiUsageDocument,
  ToolSecretDocument,
  ApiKeyDocument,
  RichWorkflowDocument,
} from "./common";

export { isDatabaseConfigured };

// Lazy-initialized client and database. The driver connects on first
// operation, so `new MongoClient(uri)` needs no awaited `connect()` and the
// collection accessors below can stay synchronous.
let client: MongoClient | null = null;
let db: Db | null = null;

function getClient(): MongoClient {
  if (!client) {
    if (!isDatabaseConfigured()) {
      throw new Error(
        "MongoDB is not configured. Please set MONGODB_URI.",
      );
    }
    client = new MongoClient(uri);
  }
  return client;
}

function getDb(): Db {
  if (!db) {
    db = getClient().db(databaseName);
  }
  return db;
}

export function getHistoryCollection(): Collection<WithMongoId<MessageDocument>> {
  return getDb().collection<WithMongoId<MessageDocument>>(historyCollectionName);
}

export function getThreadCollection(): Collection<WithMongoId<ThreadDocument>> {
  return getDb().collection<WithMongoId<ThreadDocument>>(threadCollectionName);
}

export function getAgentCollection(): Collection<WithMongoId<AgentDocument>> {
  return getDb().collection<WithMongoId<AgentDocument>>(agentCollectionName);
}

export function getPromptCollection(): Collection<WithMongoId<PromptDocument>> {
  return getDb().collection<WithMongoId<PromptDocument>>(promptCollectionName);
}

export function getMcpServerCollection(): Collection<WithMongoId<MCPServerDocument>> {
  return getDb().collection<WithMongoId<MCPServerDocument>>(mcpServerCollectionName);
}

export function getConfigCollection(): Collection<WithMongoId<ConfigDocument>> {
  return getDb().collection<WithMongoId<ConfigDocument>>(configCollectionName);
}

export function getLogCollection(): Collection<WithMongoId<LogDocument>> {
  return getDb().collection<WithMongoId<LogDocument>>(logCollectionName);
}

export function getWorkflowCollection(): Collection<WithMongoId<WorkflowDocument>> {
  return getDb().collection<WithMongoId<WorkflowDocument>>(workflowCollectionName);
}

export function getWorkflowExecutionCollection(): Collection<WithMongoId<WorkflowExecutionDocument>> {
  return getDb().collection<WithMongoId<WorkflowExecutionDocument>>(workflowExecutionCollectionName);
}

export function getToolCollection(): Collection<WithMongoId<CustomToolDocument>> {
  return getDb().collection<WithMongoId<CustomToolDocument>>(toolCollectionName);
}

export function getDocumentCollection(): Collection<WithMongoId<ChatDocument>> {
  return getDb().collection<WithMongoId<ChatDocument>>(documentCollectionName);
}

export function getDeepResearchCollection(): Collection<WithMongoId<DeepResearchReportDocument>> {
  return getDb().collection<WithMongoId<DeepResearchReportDocument>>(deepResearchCollectionName);
}

export function getMemoryCollection(): Collection<WithMongoId<MemoryDocument>> {
  return getDb().collection<WithMongoId<MemoryDocument>>(memoriesCollectionName);
}

export function getNotesCollection(): Collection<WithMongoId<NotesDocument>> {
  return getDb().collection<WithMongoId<NotesDocument>>(notesCollectionName);
}

export function getUsersCollection(): Collection<UserDocument> {
  return getDb().collection<UserDocument>(usersCollectionName);
}

export function getAutoTasksCollection(): Collection<WithMongoId<AutoTaskDocument>> {
  return getDb().collection<WithMongoId<AutoTaskDocument>>(autoTasksCollectionName);
}

export function getArtifactsCollection(): Collection<WithMongoId<ArtifactDocument>> {
  return getDb().collection<WithMongoId<ArtifactDocument>>(artifactsCollectionName);
}

export function getWebhooksCollection(): Collection<WithMongoId<WebhookDocument>> {
  return getDb().collection<WithMongoId<WebhookDocument>>(webhooksCollectionName);
}

export function getWebhookInvocationsCollection(): Collection<WithMongoId<WebhookInvocationDocument>> {
  return getDb().collection<WithMongoId<WebhookInvocationDocument>>(
    webhooksCollectionName,
  );
}

// The five accessors below exist because these collections are mixed-type,
// exactly like `webhooksCollectionName` above: `history` holds message /
// CHAT_CITATION / ai_usage documents, `tools` holds custom_tool / tool_secret /
// api_key, and `workflows` holds workflow / rich_workflow. One accessor per
// document shape, not per collection — a single union-typed accessor would
// break `docs.map(hydrateDocument)` on message reads.

export function getChatCitationsCollection(): Collection<WithMongoId<ChatCitationDocument>> {
  return getDb().collection<WithMongoId<ChatCitationDocument>>(
    historyCollectionName,
  );
}

export function getAiUsageCollection(): Collection<WithMongoId<AiUsageDocument>> {
  return getDb().collection<WithMongoId<AiUsageDocument>>(historyCollectionName);
}

export function getToolSecretsCollection(): Collection<WithMongoId<ToolSecretDocument>> {
  return getDb().collection<WithMongoId<ToolSecretDocument>>(toolCollectionName);
}

export function getApiKeysCollection(): Collection<WithMongoId<ApiKeyDocument>> {
  return getDb().collection<WithMongoId<ApiKeyDocument>>(toolCollectionName);
}

export function getRichWorkflowsCollection(): Collection<WithMongoId<RichWorkflowDocument>> {
  return getDb().collection<WithMongoId<RichWorkflowDocument>>(
    workflowCollectionName,
  );
}
