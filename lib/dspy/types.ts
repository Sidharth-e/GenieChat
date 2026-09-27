import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Supported field types for string signatures.
 * These map directly to Zod primitives.
 */
export type FieldType = "string" | "number" | "boolean" | "string[]";

/**
 * A single field in a signature (input or output).
 */
export interface SignatureField {
  name: string;
  description?: string;
  type: FieldType;
  optional?: boolean;
}

/**
 * Parsed representation of a DSPy signature.
 */
export interface ParsedSignature {
  inputs: SignatureField[];
  outputs: SignatureField[];
  instruction?: string;
}

/**
 * A training example with input-output pairs, used for few-shot demonstrations.
 */
export interface Example<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  inputs: TInput;
  outputs: TOutput;
}

/**
 * A recorded trace of a module execution, used for optimization.
 */
export interface Trace {
  id: string;
  moduleId: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  raw?: string;
  reasoning?: string;
  timestamp: number;
  durationMs: number;
  tokens?: { prompt: number; completion: number };
  modelId?: string;
  success: boolean;
  error?: string;
  score?: number;
}

/**
 * A metric function that scores a prediction against an expected output.
 * Returns a number between 0 and 1.
 */
export type Metric<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> = (
  example: Example<TInput, TOutput>,
  prediction: TOutput,
  trace?: Trace,
) => number | Promise<number>;

/**
 * Configuration for a module invocation.
 */
export interface ModuleConfig {
  /** Explicit LangChain model instance. If provided, modelId is ignored. */
  model?: BaseChatModel;
  /** Model ID to resolve via getModel(). */
  modelId?: string;
  /** Temperature override (0.0 to 1.0). */
  temperature?: number;
  /** Max retries for assertion/validation failures. */
  maxRetries?: number;
  /** Additional system instruction to prepend to the generated prompt. */
  systemInstruction?: string;
  /** Whether to stream the response (if supported by the module). */
  streaming?: boolean;
  /** Few-shot demonstrations to include in the prompt. */
  demos?: Example[];
  /** Validation function called after parsing. Throw DSPyAssertionError for retry with prompt feedback. */
  validate?: (result: Record<string, unknown>) => void | Promise<void>;
  /** Override the module ID for trace recording. */
  moduleId?: string;
}

/**
 * The result from any module execution.
 */
export interface ModuleResult<T extends Record<string, unknown>> {
  /** The structured data matching the output schema. */
  data: T;
  /** The raw LLM response before parsing, useful for debugging or logging. */
  raw?: string;
  /** Step-by-step reasoning, if produced by a ChainOfThought module. */
  reasoning?: string;
  tokens?: { prompt: number; completion: number };
}

/**
 * Definition for a Predict module that can use either a string signature or a Zod schema.
 */
export type PredictDefinition<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>,
> =
  | string // DSPy-style string signature: "input1, input2 -> output1, output2"
  | {
      inputs: SignatureField[];
      outputSchema: z.ZodType<TOutput>;
      instruction?: string;
      // Use TInput in a phantom field to ensure type checking is enforced
      _phantomInput?: TInput;
    };
