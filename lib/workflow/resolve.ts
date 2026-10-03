import type {
  HttpValue,
  OutputSchemaSourceKey,
  TipTapMentionJsonContent,
} from "./types";
import type { ConditionBranch, ConditionBranches } from "./condition";

/** nodeId → that node's output value. What `WorkflowState.outputs` holds. */
export type WorkflowOutputs = Record<string, unknown>;

/**
 * Resolve an HttpValue (a literal string, or a reference into another node's
 * output) to a concrete string. An unresolvable reference yields "" rather than
 * throwing: a missing branch is a normal outcome in a conditional graph, and
 * the node that consumes it decides whether empty is an error.
 */
export function resolveValue(
  value: HttpValue | undefined,
  outputs: WorkflowOutputs,
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const nodeOutput = outputs[(value as OutputSchemaSourceKey).nodeId];
  if (nodeOutput === undefined || nodeOutput === null) return "";
  let result: unknown = nodeOutput;
  for (const segment of (value as OutputSchemaSourceKey).path) {
    if (result && typeof result === "object" && segment in result) {
      result = (result as Record<string, unknown>)[segment];
    } else {
      return "";
    }
  }
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Resolve TipTap mention-rich content to plain text. A mention's `attrs.id` is
 * "nodeId.path.segments", split on "." into the reference it stands for.
 */
export function resolveTipTapContent(
  content: TipTapMentionJsonContent | undefined,
  outputs: WorkflowOutputs,
): string {
  if (!content?.content) return "";
  const parts: string[] = [];
  for (const block of content.content) {
    if (!block.content) {
      parts.push("");
      continue;
    }
    for (const inline of block.content) {
      if (inline.type === "text" && inline.text) {
        parts.push(inline.text);
      } else if (inline.type === "mention" && inline.attrs) {
        const [nodeId, ...pathSegments] = inline.attrs.id.split(".");
        parts.push(resolveValue({ nodeId, path: pathSegments }, outputs));
      }
    }
  }
  return parts.join("");
}

/** IF, then every ELSE IF, then ELSE — the order `routeCondition` tries them in. */
export function allConditionBranches(
  branches: ConditionBranches | undefined,
): ConditionBranch[] {
  if (!branches) return [];
  return [branches.if, ...(branches.elseIf ?? []), branches.else].filter(
    (branch): branch is ConditionBranch => Boolean(branch),
  );
}

/** Evaluate one branch. `else` is unconditional; an empty rule list is false. */
export function evaluateConditionBranch(
  branch: ConditionBranch,
  outputs: WorkflowOutputs,
): boolean {
  if (branch.type === "else") return true;
  if (branch.conditions.length === 0) return false;

  const results = branch.conditions.map((rule) => {
    const actualValue = resolveValue(rule.source, outputs);
    const expected = rule.value;

    switch (rule.operator) {
      case "eq":
        return String(actualValue) === String(expected);
      case "neq":
        return String(actualValue) !== String(expected);
      case "gt":
        return Number(actualValue) > Number(expected);
      case "lt":
        return Number(actualValue) < Number(expected);
      case "gte":
        return Number(actualValue) >= Number(expected);
      case "lte":
        return Number(actualValue) <= Number(expected);
      case "contains":
        return String(actualValue).includes(String(expected));
      case "not_contains":
        return !String(actualValue).includes(String(expected));
      case "starts_with":
        return String(actualValue).startsWith(String(expected));
      case "ends_with":
        return String(actualValue).endsWith(String(expected));
      case "is_empty":
        return !actualValue || actualValue === "";
      case "is_not_empty":
        return !!actualValue && actualValue !== "";
      case "is_true":
        return actualValue === "true" || (actualValue as unknown) === true;
      case "is_false":
        return actualValue === "false" || (actualValue as unknown) === false;
      default:
        return false;
    }
  });

  return branch.logicalOperator === "AND"
    ? results.every(Boolean)
    : results.some(Boolean);
}

/**
 * Evaluate IF / ELSE IF / ELSE and return the winning branch. Always returns a
 * branch id, so the conditional edge that consumes it always has a key to look
 * up — the mapping supplies END for branches that were left unwired.
 */
export function routeCondition(
  branches: ConditionBranches,
  outputs: WorkflowOutputs,
): { branchId: string; branchType: string } {
  if (evaluateConditionBranch(branches.if, outputs)) {
    return { branchId: branches.if.id, branchType: "if" };
  }
  for (const branch of branches.elseIf ?? []) {
    if (evaluateConditionBranch(branch, outputs)) {
      return { branchId: branch.id, branchType: "elseIf" };
    }
  }
  return { branchId: branches.else.id, branchType: "else" };
}
