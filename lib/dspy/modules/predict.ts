import { z } from "zod";
import {
  PredictDefinition,
  ModuleConfig,
  ModuleResult,
  ParsedSignature,
  Example,
} from "../types";
import { parseSignature, buildOutputSchema } from "../signature";
import { PromptBuilder } from "../prompt-builder";
import { execute, resolveModel } from "../executor";
import { traceStore } from "../trace";
import { DSPyAssertionError } from "../assertions";
import { logger } from "@/lib/logger";

let moduleCounter = 0;

/**
 * Predict module: Single-step structured AI call with support for
 * few-shot demonstrations, trace recording, and assertion-based retry.
 */
export class Predict<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  protected signature: ParsedSignature;
  protected outputSchema: z.ZodType<TOutput>;
  protected demos: Example[] = [];
  readonly moduleId: string;

  constructor(definition: PredictDefinition<TInput, TOutput>) {
    this.moduleId = `predict_${++moduleCounter}`;

    if (typeof definition === "string") {
      this.signature = parseSignature(definition);
      this.outputSchema = buildOutputSchema<TOutput>(this.signature.outputs);
    } else {
      this.signature = {
        inputs: definition.inputs,
        outputs: [], // Not used when outputSchema is provided
        instruction: definition.instruction,
      };
      this.outputSchema = definition.outputSchema;
    }
  }

  /**
   * Set few-shot demonstrations for this module.
   * These are included in every prompt unless overridden per-call via config.demos.
   */
  setDemos(demos: Example[]): this {
    this.demos = demos;
    return this;
  }

  getDemos(): Example[] {
    return [...this.demos];
  }

  /**
   * Override in subclasses to use a different schema for execution.
   * ChainOfThought uses this to add a reasoning field to the schema.
   */
  protected getExecutionSchema(): z.ZodType<unknown> {
    return this.outputSchema;
  }

  /**
   * Override in subclasses to post-process the raw execution result.
   * ChainOfThought uses this to extract reasoning from the data.
   */
  protected processResult(
    result: ModuleResult<Record<string, unknown>>,
  ): ModuleResult<TOutput> {
    return result as ModuleResult<TOutput>;
  }

  /** Whether this module uses chain-of-thought prompting. */
  protected get isChainOfThought(): boolean {
    return false;
  }

  /**
   * Forward pass: Execute the AI call with optional assertion retry.
   *
   * When config.validate is provided, the result is passed through it after parsing.
   * If validate throws DSPyAssertionError, the call is retried with the constraint
   * message appended to the prompt, up to config.maxRetries times (default 2).
   */
  async forward(
    inputs: TInput,
    config: ModuleConfig = {},
  ): Promise<ModuleResult<TOutput>> {
    const model = resolveModel(
      config.modelId,
      config.model,
      config.temperature,
    );
    const demos = config.demos || this.demos;
    const validate = config.validate;
    const maxRetries = validate ? (config.maxRetries ?? 2) : 0;

    let assertionFeedback: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();

      try {
        const systemPrompt = PromptBuilder.buildSystemPrompt(this.signature, {
          isChainOfThought: this.isChainOfThought,
          customInstruction: config.systemInstruction,
          demos,
          assertionFeedback,
        });

        const userMessage = PromptBuilder.buildUserMessage(
          this.signature.inputs,
          inputs,
        );
        const schema = this.getExecutionSchema();
        const rawResult = await execute(
          model,
          systemPrompt,
          userMessage,
          schema as z.ZodType<Record<string, unknown>>,
        );
        const result = this.processResult(rawResult);

        if (validate) {
          await validate(result.data as Record<string, unknown>);
        }

        traceStore.record({
          moduleId: config.moduleId || this.moduleId,
          inputs: inputs as Record<string, unknown>,
          outputs: result.data as Record<string, unknown>,
          raw: result.raw,
          reasoning: result.reasoning,
          tokens: result.tokens,
          timestamp: startTime,
          durationMs: Date.now() - startTime,
          modelId: config.modelId,
          success: true,
        });

        return result;
      } catch (error) {
        if (error instanceof DSPyAssertionError && attempt < maxRetries) {
          assertionFeedback = error.constraint;
          logger.warn(
            `[DSPy] Assertion failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}`,
          );
          continue;
        }

        traceStore.record({
          moduleId: config.moduleId || this.moduleId,
          inputs: inputs as Record<string, unknown>,
          outputs: {},
          timestamp: startTime,
          durationMs: Date.now() - startTime,
          modelId: config.modelId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    }

    throw new Error(
      "Unreachable: forward() retry loop ended without return or throw",
    );
  }
}
