import { ParsedSignature, SignatureField, Example } from "./types";

/**
 * Builds the system and user prompts for a DSPy module execution.
 */
export class PromptBuilder {
  /**
   * Formats few-shot examples as demonstration blocks for the prompt.
   */
  private static formatDemos(demos: Example[]): string {
    return demos
      .map((demo, i) => {
        const inputLines = Object.entries(demo.inputs)
          .map(
            ([k, v]) =>
              `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`,
          )
          .join("\n");
        const outputLines = Object.entries(demo.outputs)
          .map(
            ([k, v]) =>
              `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`,
          )
          .join("\n");
        return `--- Example ${i + 1} ---\nInput:\n${inputLines}\n\nOutput:\n${outputLines}`;
      })
      .join("\n\n");
  }

  /**
   * Generates the system prompt based on the signature, optional instruction,
   * few-shot demonstrations, and assertion feedback for retries.
   */
  static buildSystemPrompt(
    signature: ParsedSignature,
    options: {
      isChainOfThought?: boolean;
      customInstruction?: string;
      demos?: Example[];
      assertionFeedback?: string;
    } = {},
  ): string {
    const { isChainOfThought, customInstruction, demos, assertionFeedback } =
      options;
    const instruction =
      customInstruction ||
      signature.instruction ||
      "Given the input fields, produce the output fields.";

    let prompt = `${instruction}\n\n`;

    if (isChainOfThought) {
      prompt +=
        "Think step by step before producing the final output. Your response must include a 'reasoning' field explaining your thought process.\n\n";
    }

    prompt += "Input Fields:\n";
    signature.inputs.forEach((f) => {
      prompt += `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}\n`;
    });

    prompt += "\nOutput Fields:\n";
    if (isChainOfThought) {
      prompt += "- reasoning (string): Step-by-step reasoning process\n";
    }
    signature.outputs.forEach((f) => {
      prompt += `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}\n`;
    });

    if (demos && demos.length > 0) {
      prompt += "\nFollow these examples:\n\n";
      prompt += this.formatDemos(demos);
      prompt += "\n\nNow produce the output for the following input:\n";
    }

    if (assertionFeedback) {
      prompt += `\nIMPORTANT - Your previous response failed validation:\n${assertionFeedback}\nPlease correct your output to satisfy this constraint.\n`;
    }

    return prompt;
  }

  /**
   * Generates the user message by formatting the input values.
   */
  static buildUserMessage(
    inputs: SignatureField[],
    values: Record<string, unknown>,
  ): string {
    let message = "";
    inputs.forEach((f) => {
      const value = values[f.name];
      const formattedValue =
        typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : String(value);
      message += `${f.name}: ${formattedValue}\n`;
    });
    return message.trim();
  }
}
