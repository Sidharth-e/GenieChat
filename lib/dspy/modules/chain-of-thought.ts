import { z } from "zod";
import { PredictDefinition, ModuleResult } from "../types";
import { Predict } from "./predict";

/**
 * ChainOfThought module: Adds step-by-step reasoning to a structured AI call.
 *
 * Internally augments the output schema with a `reasoning` field so the LLM
 * produces reasoning alongside the output. The reasoning is then extracted
 * into `result.reasoning`, keeping `result.data` clean (matching TOutput).
 */
export class ChainOfThought<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> extends Predict<TInput, TOutput> {
  private augmentedSchema: z.ZodType<Record<string, unknown>>;
  private wrappedWithResult: boolean;

  constructor(definition: PredictDefinition<TInput, TOutput>) {
    super(definition);

    if (this.outputSchema instanceof z.ZodObject) {
      this.augmentedSchema = this.outputSchema.extend({
        reasoning: z
          .string()
          .describe(
            "Step-by-step reasoning process before producing the final output",
          ),
      });
      this.wrappedWithResult = false;
    } else {
      // Non-ZodObject schemas (rare) get wrapped with a result key
      this.augmentedSchema = z.object({
        reasoning: z
          .string()
          .describe(
            "Step-by-step reasoning process before producing the final output",
          ),
        result: this.outputSchema as z.ZodTypeAny,
      });
      this.wrappedWithResult = true;
    }
  }

  protected override get isChainOfThought(): boolean {
    return true;
  }

  protected override getExecutionSchema(): z.ZodType<unknown> {
    return this.augmentedSchema;
  }

  protected override processResult(
    result: ModuleResult<Record<string, unknown>>,
  ): ModuleResult<TOutput> {
    const { reasoning, ...rest } = result.data as Record<string, unknown> & {
      reasoning?: string;
    };
    const output = this.wrappedWithResult ? rest.result : rest;

    return {
      data: output as TOutput,
      reasoning,
      raw: result.raw,
      tokens: result.tokens,
    };
  }
}
