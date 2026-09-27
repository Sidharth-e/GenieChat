import type { OutputSchemaSourceKey } from "./types";

export const StringConditionOperator: Record<string, string> = {
  "equals": "eq",
  "not equals": "neq",
  "contains": "contains",
  "not contains": "not_contains",
  "starts with": "starts_with",
  "ends with": "ends_with",
  "is empty": "is_empty",
  "is not empty": "is_not_empty",
};

export const NumberConditionOperator: Record<string, string> = {
  "equals": "eq",
  "not equals": "neq",
  "greater than": "gt",
  "less than": "lt",
  "greater or equal": "gte",
  "less or equal": "lte",
};

export const BooleanConditionOperator: Record<string, string> = {
  "is true": "is_true",
  "is false": "is_false",
};

export type ConditionOperator = string;

export interface ConditionRule {
  source: OutputSchemaSourceKey;
  operator: ConditionOperator;
  value?: string | number | boolean;
}

export interface ConditionBranch {
  id: string;
  type: "if" | "elseIf" | "else";
  conditions: ConditionRule[];
  logicalOperator: "AND" | "OR";
}

export interface ConditionBranches {
  if: ConditionBranch;
  elseIf?: ConditionBranch[];
  else: ConditionBranch;
}

export function getFirstConditionOperator(
  type: "string" | "number" | "boolean"
): ConditionOperator {
  if (type === "number") return "eq";
  if (type === "boolean") return "is_true";
  return "eq";
}
