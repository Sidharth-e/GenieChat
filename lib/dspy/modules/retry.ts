import { ModuleConfig, ModuleResult } from "../types";
import { logger } from "@/lib/logger";

/**
 * Retry module: Wraps another module with validation-based retry logic.
 */
export class Retry<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    private module: { forward: (inputs: TInput, config?: ModuleConfig) => Promise<ModuleResult<TOutput>> },
    private options: {
      maxRetries?: number;
      validate?: (result: TOutput) => boolean | Promise<boolean>;
    } = {},
  ) {}

  /**
   * Forward pass with retries.
   */
  async forward(
    inputs: TInput,
    config: ModuleConfig = {},
  ): Promise<ModuleResult<TOutput>> {
    const maxRetries = config.maxRetries ?? this.options.maxRetries ?? 2;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.module.forward(inputs, config);

        if (this.options.validate) {
          const isValid = await this.options.validate(result.data);
          if (isValid) return result;
          
          logger.warn(`Validation failed on attempt ${attempt + 1}/${maxRetries + 1}`);
          if (attempt === maxRetries) {
            throw new Error("Validation failed after maximum retries.");
          }
        } else {
          return result;
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error(`Attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);
        
        if (attempt === maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Retry failed for unknown reasons.");
  }
}
