import { z } from "zod";
import { ParsedSignature, SignatureField, FieldType } from "./types";

/**
 * Parses a DSPy-style string signature into a structured object.
 * Format: "[instruction:] input1, input2 -> output1, output2: type"
 */
export function parseSignature(signature: string): ParsedSignature {
  // Extract instruction if present
  let instruction: string | undefined;
  let fieldPart = signature;

  if (signature.includes(":")) {
    const firstColonIndex = signature.indexOf(":");
    const arrowIndex = signature.indexOf("->");

    // If colon is before the arrow, it's likely an instruction
    if (arrowIndex === -1 || firstColonIndex < arrowIndex) {
      instruction = signature.substring(0, firstColonIndex).trim();
      fieldPart = signature.substring(firstColonIndex + 1).trim();
    }
  }

  const parts = fieldPart.split("->");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid signature format. Expected "inputs -> outputs". Got: ${signature}`,
    );
  }

  const inputs = parseFields(parts[0]);
  const outputs = parseFields(parts[1]);

  return { inputs, outputs, instruction };
}

/**
 * Parses a comma-separated list of fields.
 * Format: "field1, field2: type, field3?"
 */
function parseFields(fieldString: string): SignatureField[] {
  return fieldString
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .map((f) => {
      let name = f;
      let type: FieldType = "string";
      let optional = false;

      // Check for optional marker (?)
      if (name.endsWith("?")) {
        optional = true;
        name = name.slice(0, -1).trim();
      }

      // Check for type annotation (:)
      if (name.includes(":")) {
        const [fieldName, fieldType] = name.split(":").map((s) => s.trim());
        name = fieldName;
        type = validateType(fieldType);
      }

      return { name, type, optional };
    });
}

/**
 * Validates and maps a string type to a supported FieldType.
 */
function validateType(type: string): FieldType {
  const t = type.toLowerCase();
  if (t === "string" || t === "number" || t === "boolean" || t === "string[]") {
    return t as FieldType;
  }
  // Allow common aliases
  if (t === "array" || t === "list") return "string[]";
  if (t === "int" || t === "float") return "number";
  if (t === "bool") return "boolean";

  throw new Error(`Unsupported field type: ${type}`);
}

/**
 * Builds a Zod schema from an array of SignatureFields.
 */
export function buildOutputSchema<T extends Record<string, unknown>>(
  fields: SignatureField[],
): z.ZodType<T> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema: z.ZodTypeAny;

    switch (field.type) {
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "string[]":
        schema = z.array(z.string());
        break;
      case "string":
      default:
        schema = z.string();
        break;
    }

    if (field.description) {
      schema = schema.describe(field.description);
    } else {
      // Default description to the field name for better LLM guidance
      schema = schema.describe(field.name);
    }

    if (field.optional) {
      schema = schema.optional();
    }

    shape[field.name] = schema;
  }

  return z.object(shape) as unknown as z.ZodType<T>;
}
