/**
 * MongoDB configuration - re-exports from centralized config for backward compatibility.
 */
import { config } from "@/lib/config";

const uri = config.mongodb.uri;
const databaseName = config.mongodb.databaseName;
const historyCollectionName = config.mongodb.collections.history;
const threadCollectionName = config.mongodb.collections.threads;
const agentCollectionName = config.mongodb.collections.agents;
const promptCollectionName = config.mongodb.collections.prompts;
const mcpServerCollectionName = config.mongodb.collections.mcpServers;
const configCollectionName = config.mongodb.collections.config;
const logCollectionName = config.mongodb.collections.logs;
const workflowCollectionName = config.mongodb.collections.workflows;
const workflowExecutionCollectionName = config.mongodb.collections.workflowExecutions;
const toolCollectionName = config.mongodb.collections.tools;
const documentCollectionName = config.mongodb.collections.documents;
const deepResearchCollectionName = config.mongodb.collections.deepResearch;
const notesCollectionName = config.mongodb.collections.notes;
const usersCollectionName = config.mongodb.collections.users;
const autoTasksCollectionName = config.mongodb.collections.autoTasks;
const artifactsCollectionName = config.mongodb.collections.artifacts;
const webhooksCollectionName = config.mongodb.collections.webhooks;
const schedulesCollectionName = config.mongodb.collections.schedules;
const scheduleRunsCollectionName = config.mongodb.collections.scheduleRuns;

export {
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
  notesCollectionName,
  usersCollectionName,
  autoTasksCollectionName,
  artifactsCollectionName,
  webhooksCollectionName,
  schedulesCollectionName,
  scheduleRunsCollectionName,
};
