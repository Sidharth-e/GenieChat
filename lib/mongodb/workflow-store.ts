import { logger } from "@/lib/logger";
import { Collection } from "mongodb";
import {
  getWorkflowCollection,
  getWorkflowExecutionCollection,
  getRichWorkflowsCollection,
} from "./client";
import {
  Workflow,
  WorkflowExecution,
  RichWorkflow,
  RichWorkflowNode,
  RichWorkflowEdge,
} from "../types";
import { generateId } from "../utils";
import {
  WithMongoId,
  WorkflowDocument,
  WorkflowExecutionDocument,
  RichWorkflowDocument,
  hydrateDocument,
} from "./common";

/**
 * Cosmos stored documents as JSON, so an `undefined` `nextRunAt` was dropped
 * from the stored document and read back as absent (`IS_DEFINED(c.nextRunAt) =
 * false`). The Mongo driver would write it as `null` instead, and the two are
 * not interchangeable to `getScheduledWorkflows`: a workflow that has never run
 * is due through its `{ nextRunAt: { $exists: false } }` branch, and `$lte`
 * does not compare across BSON types, so a stored `null` is never `<=` an ISO
 * string. Deleting the key keeps the stored shape — and therefore the due
 * schedule — identical to Cosmos.
 *
 * Measured, not assumed: with a `null`-valued `nextRunAt` document and an
 * absent-key document side by side, `{ nextRunAt: { $lte: <iso> } }` returns
 * only the document that holds a comparable string (a `null` never matches
 * it), and `$exists: false` returns only the absent-key one. The driver also
 * stores an explicit `undefined` as `null`, so this helper — not the driver —
 * is what preserves the Cosmos shape.
 */
export function dropUnsetNextRunAt<T extends { nextRunAt?: string }>(doc: T): T {
  if (doc.nextRunAt === undefined) delete doc.nextRunAt;
  return doc;
}

/**
 * Deletes every key whose value is exactly `undefined`, in place.
 *
 * A partial update is built as `{ ...stored, ...updates }` and written back
 * with `replaceOne`, so an `undefined` in `updates` is not "leave this field
 * alone": it is an own key that displaces the stored value, and the driver
 * stores it as `null` rather than dropping it. A caller that sends only the
 * fields it means to change — a rename, or a later client sending `{ trigger }`
 * alone — would otherwise erase every field it did not mention: a `null` trigger
 * stops a scheduled workflow being scheduled and drops a webhook's secret. The
 * same applies on insert, where an omitted optional field would be stored as
 * `null` in a document whose absent-key shape is what the readers test for.
 *
 * `null` is kept deliberately. It is a value a caller chose to send — the legacy
 * schedule path writes it to mean "no longer on a schedule" — not a missing
 * field. Only exact `undefined` is a hole.
 */
export function dropUndefinedFields<T extends object>(doc: T): T {
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return doc;
}

/**
 * The `updatedAt` to store on a workflow document whose current value is
 * `previous`: the wall clock, unless the write lands in the same millisecond as
 * `previous`, in which case it is advanced to the next millisecond so it still
 * differs.
 *
 * `updateWorkflowSchedule` claims a due run with a compare-and-swap on
 * `updatedAt` (Mongo has no Cosmos `_etag`), so it only detects a competing
 * writer if a write always *changes* `updatedAt`. An ISO string has
 * millisecond resolution, so two writes inside one millisecond would otherwise
 * store a byte-identical value, leave the loser's filter matching, and let both
 * claimers run the workflow. Every write this store makes to a workflow
 * document goes through here, which is what makes the value a version token
 * rather than just a timestamp: the write changes the token it compared
 * against, so at most one of two claimers holding the same version can match.
 *
 * The invariant it actually guarantees is `max(wall clock, previous + 1 ms)`,
 * not "the wall clock, give or take a millisecond". The stored value is an ISO
 * 8601 string and is never *earlier* than the clock at the moment of writing —
 * but it can be *ahead* of it: while the clock does not move past the value,
 * every consecutive write through here lands 1 ms further ahead, and the first
 * write at least a millisecond later resets it to the wall clock. So a consumer
 * may rely on `updatedAt >= wall clock at write time` and on the value being
 * canonical UTC ISO, but not on `updatedAt <= Date.now()`.
 */
export function nextUpdatedAt(previous: string): string {
  const previousMs = Date.parse(previous);
  const nowMs = Date.now();
  if (Number.isNaN(previousMs) || nowMs > previousMs) {
    return new Date(nowMs).toISOString();
  }
  return new Date(previousMs + 1).toISOString();
}

export class WorkflowStore {
  private workflowCollection: Collection<WithMongoId<WorkflowDocument>>;
  /**
   * Rich workflows live in the same `workflows` collection as plain ones but
   * are a different document shape, so they get their own accessor rather than
   * a reuse of `this.workflowCollection`: that one is typed
   * `WithMongoId<WorkflowDocument>`, whose `Condition` rejects
   * `type: "rich_workflow"` outright.
   */
  private richWorkflowCollection: Collection<WithMongoId<RichWorkflowDocument>>;
  private executionCollection: Collection<WithMongoId<WorkflowExecutionDocument>>;

  constructor() {
    this.workflowCollection = getWorkflowCollection();
    this.richWorkflowCollection = getRichWorkflowsCollection();
    this.executionCollection = getWorkflowExecutionCollection();
  }

  // Create a new workflow
  async createWorkflow(
    workflow: Omit<Workflow, "id" | "createdAt" | "updatedAt">,
  ): Promise<Workflow> {
    const now = new Date().toISOString();

    // Ensure each step has an id
    const stepsWithIds = workflow.steps.map((step, index) => ({
      ...step,
      id: step.id || generateId(),
      order: index,
      status: "pending" as const,
    }));

    const id = generateId();
    const newWorkflow: WithMongoId<WorkflowDocument> = {
      ...workflow,
      steps: stepsWithIds,
      id,
      _id: id,
      type: "workflow",
      createdAt: now,
      updatedAt: now,
    };
    dropUnsetNextRunAt(newWorkflow);

    await this.workflowCollection.insertOne(newWorkflow);
    return hydrateDocument(newWorkflow);
  }

  // Get all workflows for a user
  async getWorkflows(userId: string): Promise<Workflow[]> {
    const docs = await this.workflowCollection
      .find({ userId, type: "workflow" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  // Get all scheduled workflows that are due to run
  async getScheduledWorkflows(): Promise<Workflow[]> {
    const now = new Date().toISOString();

    const docs = await this.workflowCollection
      .find({
        type: "workflow",
        "trigger.type": "schedule",
        $or: [
          { nextRunAt: { $exists: false } },
          { nextRunAt: { $lte: now } },
        ],
      })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  // Atomically update the schedule for a workflow to prevent duplicate runs
  async updateWorkflowSchedule(
    workflowId: string,
    // `userId` is kept only for signature compatibility with the Cosmos store:
    // `_id` is a globally unique uuidv7, so the update no longer needs it. No
    // eslint-disable directive is needed: the rule's default `after-used`
    // option only reports arguments *after* the last one that is used.
    userId: string,
    lastRunAt: string,
    nextRunAt: string | null,
  ): Promise<boolean> {
    try {
      const existingDoc = await this.getWorkflowDocument(workflowId);
      if (!existingDoc) return false;

      const updated: WithMongoId<WorkflowDocument> = {
        ...existingDoc,
        lastRunAt,
        nextRunAt: nextRunAt || undefined,
        updatedAt: nextUpdatedAt(existingDoc.updatedAt),
      };
      dropUnsetNextRunAt(updated);

      // Cosmos claimed this run with an `IfMatch` access condition on the
      // document's `_etag`, so a concurrent claim lost with a 412 rather than
      // overwriting the winner. Mongo has no `_etag`, so this is the substitute:
      // a compare-and-swap that replaces the document only while `updatedAt`
      // still holds the value that was just read. `matchedCount === 0` means it
      // no longer does, i.e. another writer moved the document on between the
      // read and the write — the contention Cosmos reported as 412.
      //
      // What it guarantees, measured: of two claimers that read the same
      // version, at most one matches, because `nextUpdatedAt` guarantees the
      // winner stores a value different from the one the loser's filter compares
      // against. Forcing both claimers to read before either wrote gave exactly
      // one winner in 25/25 rounds; the same loop before that guarantee existed
      // double-claimed 4/25. An `_etag` is still the stronger token, though, and
      // two limits remain:
      //
      //  1. A claimer whose *read* lands after another claimer's *write* accepts,
      //     and both run the workflow. That is the read-then-CAS protocol, not
      //     this token: the document the second claimer reads is already
      //     current, and the fact that the run was claimed exists only in the
      //     caller's earlier `getScheduledWorkflows()` list. Cosmos's `_etag`
      //     had the same limit.
      //  2. A writer outside this compare-and-swap that stores the identical
      //     `updatedAt` value is undetectable — it can only do that by writing in
      //     the same millisecond as the value it read, which is the resolution
      //     limit of an ISO string and the reason an ETag is strictly stronger.
      const { _id, ...rest } = updated;
      const result = await this.workflowCollection.replaceOne(
        { _id, updatedAt: existingDoc.updatedAt },
        rest,
      );
      if (result.matchedCount === 0) {
        // Normal contention, not a fault: another scheduler instance claimed
        // this run first (or the workflow was updated or deleted) after the
        // schedule was read. Cosmos logged its 412 branch at info and returned
        // false; the caller only needs to skip this run, so neither a throw nor
        // an error-level entry is warranted. A genuine fault — a driver error
        // from the read or the replace — is still caught and logged as an error
        // below.
        logger.info(
          `Workflow ${workflowId} schedule update skipped: already claimed by another instance.`,
        );
        return false;
      }

      return true;
    } catch (error: unknown) {
      logger.error("Error updating workflow schedule:", error);
      return false;
    }
  }

  // Get a single workflow
  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    try {
      const doc = await this.workflowCollection.findOne({
        _id: workflowId,
        type: "workflow",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting workflow:", error);
      return null;
    }
  }

  // Get raw document for update/delete
  private async getWorkflowDocument(
    workflowId: string,
  ): Promise<WithMongoId<WorkflowDocument> | null> {
    try {
      return await this.workflowCollection.findOne({
        _id: workflowId,
        type: "workflow",
      });
    } catch (error) {
      logger.error("Error getting workflow document:", error);
      return null;
    }
  }

  // Update a workflow
  async updateWorkflow(
    workflowId: string,
    updates: Partial<Workflow>,
  ): Promise<Workflow | null> {
    try {
      const existingDoc = await this.getWorkflowDocument(workflowId);
      if (!existingDoc) return null;

      const updated: WithMongoId<WorkflowDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // workflow or move it in a listing.
        userId: existingDoc.userId,
        type: "workflow",
        createdAt: existingDoc.createdAt,
        updatedAt: nextUpdatedAt(existingDoc.updatedAt),
      };
      dropUnsetNextRunAt(updated);

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.workflowCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Workflow not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating workflow:", error);
      return null;
    }
  }

  // Delete a workflow
  async deleteWorkflow(workflowId: string): Promise<boolean> {
    try {
      const existingDoc = await this.getWorkflowDocument(workflowId);
      if (!existingDoc) return false;

      await this.workflowCollection.deleteOne({ _id: workflowId });
      return true;
    } catch (error) {
      logger.error("Error deleting workflow:", error);
      return false;
    }
  }

  // --- Execution Methods ---

  async createExecution(
    execution: Omit<WorkflowExecution, "id" | "createdAt" | "updatedAt">,
  ): Promise<WorkflowExecution> {
    const now = new Date().toISOString();
    const id = generateId();
    const newExecution: WithMongoId<WorkflowExecutionDocument> = {
      ...execution,
      id,
      _id: id,
      createdAt: now,
      updatedAt: now,
      type: "execution",
    };

    await this.executionCollection.insertOne(newExecution);
    return hydrateDocument(newExecution);
  }

  async updateExecution(
    executionId: string,
    // `workflowId` is kept only for signature compatibility with the Cosmos
    // store, where it fed the partition-key fallback replaces: `_id` is a
    // globally unique uuidv7, so the update no longer needs it. No eslint-disable
    // directive is needed: the rule's default `after-used` option only reports
    // arguments *after* the last one that is used.
    workflowId: string,
    updates: Partial<WorkflowExecution>,
  ): Promise<WorkflowExecution | null> {
    try {
      const existingDoc = await this.executionCollection.findOne({
        _id: executionId,
        type: "execution",
      });

      if (!existingDoc) return null;

      const updated: WithMongoId<WorkflowExecutionDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // execution or move it in a listing.
        userId: existingDoc.userId,
        createdAt: existingDoc.createdAt,
        updatedAt: new Date().toISOString(),
        type: "execution",
      };

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.executionCollection.replaceOne({ _id: existingDoc._id }, rest);
      if (result.matchedCount === 0) {
        throw new Error(`Execution not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating execution:", error);
      return null;
    }
  }

  async getExecutions(workflowId: string): Promise<WorkflowExecution[]> {
    const docs = await this.executionCollection
      .find({ workflowId, type: "execution" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  async getLatestExecution(
    workflowId: string,
  ): Promise<WorkflowExecution | null> {
    const doc = await this.executionCollection.findOne(
      { workflowId, type: "execution" },
      { sort: { createdAt: -1 } },
    );

    return doc ? hydrateDocument(doc) : null;
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    try {
      const doc = await this.executionCollection.findOne({
        _id: executionId,
        type: "execution",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting execution:", error);
      return null;
    }
  }

  // --- Rich Workflow Methods ---

  // Create a new rich workflow
  async createRichWorkflow(
    workflow: Omit<RichWorkflow, "id" | "createdAt" | "updatedAt">,
  ): Promise<RichWorkflow> {
    const now = new Date().toISOString();
    const id = generateId();
    const doc: WithMongoId<RichWorkflowDocument> = {
      ...workflow,
      id,
      _id: id,
      type: "rich_workflow",
      createdAt: now,
      updatedAt: now,
    };
    dropUndefinedFields(doc);

    await this.richWorkflowCollection.insertOne(doc);
    return hydrateDocument(doc);
  }

  // Get a single rich workflow by ID
  async getRichWorkflow(workflowId: string): Promise<RichWorkflow | null> {
    try {
      const doc = await this.richWorkflowCollection.findOne({
        _id: workflowId,
        type: "rich_workflow",
      });

      return doc ? hydrateDocument(doc) : null;
    } catch (error) {
      logger.error("Error getting rich workflow:", error);
      return null;
    }
  }

  // Get all rich workflows for a user
  async getRichWorkflows(userId: string): Promise<RichWorkflow[]> {
    const docs = await this.richWorkflowCollection
      .find({ userId, type: "rich_workflow" })
      .sort({ createdAt: -1 })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  // Update rich workflow metadata (name, description, published state)
  async updateRichWorkflow(
    workflowId: string,
    updates: Partial<
      Pick<
        RichWorkflow,
        | "name"
        | "description"
        | "isPublished"
        | "visibility"
        | "icon"
        | "trigger"
        | "lastRunAt"
        | "nextRunAt"
      >
    >,
  ): Promise<RichWorkflow | null> {
    try {
      const existingDoc = await this.getRichWorkflowDocument(workflowId);
      if (!existingDoc) return null;

      const updated: WithMongoId<RichWorkflowDocument> = {
        ...existingDoc,
        ...updates,
        // Re-asserted after the caller's spread, so a body cannot re-own the
        // workflow or move it in a listing.
        userId: existingDoc.userId,
        type: "rich_workflow",
        createdAt: existingDoc.createdAt,
        updatedAt: nextUpdatedAt(existingDoc.updatedAt),
      };
      dropUndefinedFields(updated);

      // The filter comes from the read, not the merge.
      const { _id, ...rest } = updated;
      const result = await this.richWorkflowCollection.replaceOne(
        { _id: existingDoc._id },
        rest,
      );
      if (result.matchedCount === 0) {
        throw new Error(`Rich workflow not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating rich workflow:", error);
      return null;
    }
  }

  // Update rich workflow structure with a diff of changed nodes/edges
  async updateRichWorkflowStructure(
    workflowId: string,
    diff: {
      nodes: RichWorkflowNode[];
      edges: RichWorkflowEdge[];
      deleteNodes: string[];
      deleteEdges: string[];
    },
  ): Promise<RichWorkflow | null> {
    try {
      const existingDoc = await this.getRichWorkflowDocument(workflowId);
      if (!existingDoc) return null;

      // Apply node updates/additions
      const updatedNodes = existingDoc.nodes.filter(
        (n) => !diff.deleteNodes.includes(n.id),
      );
      for (const node of diff.nodes) {
        const idx = updatedNodes.findIndex((n) => n.id === node.id);
        if (idx >= 0) {
          updatedNodes[idx] = node;
        } else {
          updatedNodes.push(node);
        }
      }

      // Apply edge updates/additions
      const updatedEdges = existingDoc.edges.filter(
        (e) => !diff.deleteEdges.includes(e.id),
      );
      for (const edge of diff.edges) {
        const idx = updatedEdges.findIndex((e) => e.id === edge.id);
        if (idx >= 0) {
          updatedEdges[idx] = edge;
        } else {
          updatedEdges.push(edge);
        }
      }

      const updated: WithMongoId<RichWorkflowDocument> = {
        ...existingDoc,
        nodes: updatedNodes,
        edges: updatedEdges,
        updatedAt: nextUpdatedAt(existingDoc.updatedAt),
      };

      // Deliberately left unfixed — unlike its sibling `updateRichWorkflow`
      // above, every field in this merge after `...existingDoc` is computed
      // here (`nodes`, `edges`, `updatedAt`), so no caller-supplied object
      // reaches the filter and `_id` can only ever be `existingDoc._id`.
      const { _id, ...rest } = updated;
      const result = await this.richWorkflowCollection.replaceOne(
        { _id },
        rest,
      );
      if (result.matchedCount === 0) {
        throw new Error(`Rich workflow not found: ${_id}`);
      }

      return hydrateDocument(updated);
    } catch (error) {
      logger.error("Error updating rich workflow structure:", error);
      return null;
    }
  }

  // Delete a rich workflow
  async deleteRichWorkflow(workflowId: string): Promise<boolean> {
    try {
      const existingDoc = await this.getRichWorkflowDocument(workflowId);
      if (!existingDoc) return false;

      await this.richWorkflowCollection.deleteOne({ _id: workflowId });
      return true;
    } catch (error) {
      logger.error("Error deleting rich workflow:", error);
      return false;
    }
  }

  /**
   * The schedule driver's read. Identical due-window semantics to
   * `getScheduledWorkflows`, but over the rich collection: a workflow is due
   * when it is on a schedule and either has never run or its next fire time has
   * passed. `$exists: false` is why `dropUnsetNextRunAt` has to run on every
   * write — an explicit `null` would match neither arm.
   */
  async getScheduledRichWorkflows(nowISO: string): Promise<RichWorkflow[]> {
    const docs = await this.richWorkflowCollection
      .find({
        type: "rich_workflow",
        "trigger.type": "schedule",
        $or: [
          { nextRunAt: { $exists: false } },
          { nextRunAt: { $lte: nowISO } },
        ],
      })
      .toArray();

    return docs.map((doc) => hydrateDocument(doc));
  }

  /**
   * Claims one due run by compare-and-swap on `updatedAt`: the filter carries
   * the version this runner read, so of two runners evaluating the same tick
   * exactly one matches and the other is told it lost. Returns false rather than
   * throwing — losing a race is an ordinary outcome, not an error.
   */
  async claimRichWorkflowSchedule(
    workflowId: string,
    userId: string,
    lastRunAt: string,
    nextRunAt: string | undefined,
  ): Promise<boolean> {
    const existingDoc = await this.richWorkflowCollection.findOne({
      _id: workflowId,
      userId,
    });
    if (!existingDoc) return false;

    const updated = dropUnsetNextRunAt({
      ...existingDoc,
      lastRunAt,
      nextRunAt,
      updatedAt: nextUpdatedAt(existingDoc.updatedAt),
    });

    const result = await this.richWorkflowCollection.replaceOne(
      { _id: workflowId, updatedAt: existingDoc.updatedAt },
      updated,
    );

    if (result.matchedCount === 0) {
      logger.info(
        { workflowId },
        "Rich workflow schedule already claimed by another runner",
      );
      return false;
    }

    return true;
  }

  // Get raw rich workflow document for update/delete
  private async getRichWorkflowDocument(
    workflowId: string,
  ): Promise<WithMongoId<RichWorkflowDocument> | null> {
    try {
      return await this.richWorkflowCollection.findOne({
        _id: workflowId,
        type: "rich_workflow",
      });
    } catch (error) {
      logger.error("Error getting rich workflow document:", error);
      return null;
    }
  }
}
