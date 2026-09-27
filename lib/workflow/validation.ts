import { WorkflowStep } from "@/lib/types";

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

interface NormalizedStepForValidation {
  id: string;
  name: string;
  agentId: string;
  nextSteps: string[];
}

function normalizeStep(step: Partial<WorkflowStep>, index: number): NormalizedStepForValidation {
  const id = (step.id || "").trim() || `step_${index}`;

  return {
    id,
    name: (step.name || "").trim(),
    agentId: (step.agentId || "").trim(),
    nextSteps: Array.isArray(step.nextSteps) ? step.nextSteps.filter(Boolean) : [],
  };
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

export function validateWorkflowSteps(steps: Array<Partial<WorkflowStep>>): WorkflowValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, errors: ["At least one step is required."] };
  }

  const normalized = steps.map((step, index) => normalizeStep(step, index));

  const idSet = new Set<string>();
  for (const [index, step] of normalized.entries()) {
    if (idSet.has(step.id)) {
      errors.push(`Duplicate step id "${step.id}" at step ${index + 1}.`);
      continue;
    }
    idSet.add(step.id);
  }

  for (const [index, step] of normalized.entries()) {
    if (!step.name) {
      errors.push(`Step ${index + 1} is missing a name.`);
    }

    if (!step.agentId) {
      errors.push(`Agent step "${step.name || step.id}" must select an agent.`);
    }
  }

  for (const step of normalized) {
    for (const nextId of step.nextSteps) {
      if (!idSet.has(nextId)) {
        errors.push(`Step "${step.name || step.id}" points to missing next step "${nextId}".`);
      }
      if (nextId === step.id) {
        errors.push(`Step "${step.name || step.id}" cannot point to itself.`);
      }
    }
  }

  const parentCount = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  normalized.forEach((step) => {
    parentCount.set(step.id, 0);
    adjacency.set(step.id, []);
  });

  normalized.forEach((step) => {
    for (const nextId of step.nextSteps) {
      if (!idSet.has(nextId)) continue;
      adjacency.get(step.id)?.push(nextId);
      parentCount.set(nextId, (parentCount.get(nextId) || 0) + 1);
    }
  });

  const startSteps = normalized.filter((step) => (parentCount.get(step.id) || 0) === 0);
  if (startSteps.length === 0) {
    errors.push("Workflow graph has no start step. Remove circular dependencies.");
  }

  const queue: string[] = startSteps.map((step) => step.id);
  const localParentCount = new Map(parentCount);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;

    for (const nextId of adjacency.get(current) || []) {
      const remaining = (localParentCount.get(nextId) || 0) - 1;
      localParentCount.set(nextId, remaining);
      if (remaining === 0) {
        queue.push(nextId);
      }
    }
  }

  if (visited !== normalized.length) {
    errors.push("Workflow graph contains a cycle. Cycles are not supported.");
  }

  const unique = uniqueErrors(errors);
  return {
    valid: unique.length === 0,
    errors: unique,
  };
}
