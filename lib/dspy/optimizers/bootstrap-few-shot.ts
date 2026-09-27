import { logger } from "@/lib/logger";
import { Example, Metric, ModuleConfig } from "../types";
import { Predict } from "../modules/predict";

export interface BootstrapFewShotConfig {
  /** Max bootstrapped (model-generated) demos to collect. Default: 4. */
  maxBootstrappedDemos?: number;
  /** Max labeled (gold-standard) demos from the training set to include. Default: 4. */
  maxLabeledDemos?: number;
  /** Minimum metric score to accept a bootstrapped demo. Default: 0.7. */
  minScore?: number;
  /** Config overrides for the teacher (e.g., use a stronger model to generate demos). */
  teacherConfig?: ModuleConfig;
}

/**
 * BootstrapFewShot optimizer — the core self-improving loop.
 *
 * 1. Runs training examples through the module (optionally with a stronger "teacher" config).
 * 2. Scores each prediction with the provided metric.
 * 3. Collects high-scoring (input, prediction) pairs as few-shot demonstrations.
 * 4. Sets the collected demos on the module for all future calls.
 *
 * Usage:
 * ```ts
 * const optimizer = new BootstrapFewShot({ maxBootstrappedDemos: 4, minScore: 0.8 });
 * await optimizer.compile(summarizer, trainingExamples, myMetric);
 * // summarizer now has optimized few-shot demos baked in
 * ```
 */
export class BootstrapFewShot<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  private maxBootstrappedDemos: number;
  private maxLabeledDemos: number;
  private minScore: number;
  private teacherConfig?: ModuleConfig;

  constructor(config: BootstrapFewShotConfig = {}) {
    this.maxBootstrappedDemos = config.maxBootstrappedDemos ?? 4;
    this.maxLabeledDemos = config.maxLabeledDemos ?? 4;
    this.minScore = config.minScore ?? 0.7;
    this.teacherConfig = config.teacherConfig;
  }

  /**
   * Optimize the module using the training set and metric.
   * Mutates the module's demos in place and returns it.
   */
  async compile(
    module: Predict<TInput, TOutput>,
    trainSet: Example<TInput, TOutput>[],
    metric: Metric<TInput, TOutput>,
  ): Promise<Predict<TInput, TOutput>> {
    const bootstrappedDemos: Example[] = [];
    let successes = 0;
    let failures = 0;

    logger.info(
      `[BootstrapFewShot] Starting compilation with ${trainSet.length} training examples`,
    );

    for (const example of trainSet) {
      if (bootstrappedDemos.length >= this.maxBootstrappedDemos) break;

      try {
        const result = await module.forward(
          example.inputs,
          this.teacherConfig || {},
        );
        const score = await metric(example, result.data);

        if (score >= this.minScore) {
          bootstrappedDemos.push({
            inputs: example.inputs as Record<string, unknown>,
            outputs: result.data as Record<string, unknown>,
          });
          successes++;
          logger.info(
            `[BootstrapFewShot] Example passed (score=${score.toFixed(2)}), ` +
              `${bootstrappedDemos.length}/${this.maxBootstrappedDemos} demos collected`,
          );
        } else {
          failures++;
          logger.info(
            `[BootstrapFewShot] Example below threshold ` +
              `(score=${score.toFixed(2)}, min=${this.minScore})`,
          );
        }
      } catch (error) {
        failures++;
        logger.warn(
          `[BootstrapFewShot] Example failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Include labeled (gold-standard) demos from the training set
    const labeledDemos: Example[] = trainSet
      .slice(0, this.maxLabeledDemos)
      .map((ex) => ({
        inputs: ex.inputs as Record<string, unknown>,
        outputs: ex.outputs as Record<string, unknown>,
      }));

    // Combine: labeled first (ground truth), then bootstrapped (model-generated)
    const allDemos = [...labeledDemos, ...bootstrappedDemos].slice(
      0,
      this.maxBootstrappedDemos + this.maxLabeledDemos,
    );

    module.setDemos(allDemos);

    logger.info(
      `[BootstrapFewShot] Compilation complete: ${allDemos.length} demos ` +
        `(${labeledDemos.length} labeled + ${bootstrappedDemos.length} bootstrapped), ` +
        `${successes} passed, ${failures} failed`,
    );

    return module;
  }
}
