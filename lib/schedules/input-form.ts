import { z, type ZodType } from "zod";

export type InputFieldKind = "text" | "textarea" | "number" | "boolean" | "json";

export interface InputField {
  name: string;
  label: string;
  kind: InputFieldKind;
  required: boolean;
  description?: string;
  placeholder?: string;
}

export interface InputForm {
  fields: InputField[];
  /**
   * True when the schema could not be expressed as fields and the single
   * `json` field is the whole form. The component reads this to say so.
   */
  jsonFallback: boolean;
}

/** The field name the JSON fallback reports under. */
export const INPUT_JSON_FIELD = "input";

/** `maxTokens` -> `Max tokens`, `to` -> `To`. */
function labelFor(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function describeLeaf(schema: ZodType): InputFieldKind | null {
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodString) return "textarea";
  return null;
}

/**
 * A JSON editor for a schema this module cannot render field by field.
 *
 * This is the fallback rather than an error because the alternative is worse in
 * exactly the case that matters: a future executor with a nested `inputSchema`
 * would otherwise present an empty form whose Save always fails validation, with
 * nothing on screen to say why. One JSON box is less pleasant than fields and
 * infinitely more useful than nothing.
 */
function jsonForm(description?: string): InputForm {
  return {
    fields: [
      {
        name: INPUT_JSON_FIELD,
        label: "Input (JSON)",
        kind: "json",
        required: true,
        description:
          description ??
          "This target's input is structured, so it is edited as JSON.",
      },
    ],
    jsonFallback: true,
  };
}

export function buildInputForm(schema: ZodType): InputForm {
  const description = schema.description;

  if (!(schema instanceof z.ZodObject)) return jsonForm(description);

  const shape = schema.shape as Record<string, ZodType>;
  const names = Object.keys(shape);
  if (names.length === 0) return jsonForm(description);

  const fields: InputField[] = [];
  for (const name of names) {
    const raw = shape[name];

    // `z.string().optional()` and `z.string().default(x)` are both *wrappers*
    // around a leaf in Zod 4, not modifiers on it -- the leaf is what carries the
    // kind and the description, so the wrappers are peeled off and remembered.
    // Peeled in a loop rather than one `instanceof`, because either can wrap the
    // other: `z.string().optional().default(x)` is a default around an optional.
    let inner: ZodType = raw;
    let optional = false;
    let hasDefault = false;
    while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
      if (inner instanceof z.ZodOptional) optional = true;
      else hasDefault = true;
      inner = inner.unwrap() as ZodType;
    }

    const kind = describeLeaf(inner);
    if (!kind) return jsonForm(description);

    // A field with a default is filled in when it is absent, so the form does not
    // require the user to type it -- the same reason an optional field is not
    // required, arrived at differently.
    fields.push({
      name,
      label: labelFor(name),
      kind,
      required: !optional && !hasDefault,
      ...(inner.description ? { description: inner.description } : {}),
      ...(kind === "number" ? { placeholder: "0" } : {}),
    });
  }

  return { fields, jsonFallback: false };
}

/**
 * Form values (every one a string, because every one came from an input) to the
 * object the executor's schema will validate.
 *
 * A blank field is *omitted*, never sent as `""` or `0`: `Number("")` is `0`, so
 * treating a blank number input as a value would silently schedule a run with
 * `count: 0` when the user left it empty. The same rule makes an optional field
 * left blank stay absent rather than becoming an empty string the schema then
 * rejects.
 */
export function coerceInputValues(
  form: InputForm,
  values: Record<string, string>,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (form.jsonFallback) {
    const raw = (values[INPUT_JSON_FIELD] ?? "").trim();
    if (!raw) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, message: "That input is not valid JSON." };
    }
  }

  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    const raw = (values[field.name] ?? "").trim();

    if (!raw) {
      if (field.required) {
        return { ok: false, message: `${field.label} is required.` };
      }
      continue;
    }

    if (field.kind === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, message: `${field.label} must be a number.` };
      }
      out[field.name] = parsed;
      continue;
    }

    if (field.kind === "boolean") {
      out[field.name] = raw === "true";
      continue;
    }

    out[field.name] = raw;
  }

  return { ok: true, value: out };
}
