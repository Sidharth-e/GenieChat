import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildInputForm, coerceInputValues } from "@/lib/schedules/input-form";

describe("buildInputForm", () => {
  it("describes a single required string as a textarea", () => {
    const form = buildInputForm(
      z.object({ message: z.string().min(1).describe("What to say") }),
    );
    expect(form.jsonFallback).toBe(false);
    expect(form.fields).toEqual([
      {
        name: "message",
        label: "Message",
        kind: "textarea",
        required: true,
        description: "What to say",
      },
    ]);
  });

  it("marks a field with a default as not required", () => {
    const form = buildInputForm(
      z.object({ message: z.string().min(1), tone: z.string().default("plain") }),
    );
    expect(form.fields.find((f) => f.name === "tone")?.required).toBe(false);
  });

  it("marks an optional field as not required", () => {
    const form = buildInputForm(
      z.object({ message: z.string().min(1), note: z.string().optional() }),
    );
    expect(form.fields.find((f) => f.name === "note")?.required).toBe(false);
  });

  it("renders number and boolean leaves by kind", () => {
    const form = buildInputForm(z.object({ count: z.number(), dryRun: z.boolean() }));
    expect(form.fields.map((f) => f.kind)).toEqual(["number", "boolean"]);
  });

  it("turns a dotted field name into a readable label", () => {
    const form = buildInputForm(z.object({ maxTokens: z.number() }));
    expect(form.fields[0].label).toBe("Max tokens");
  });

  // Review Focus 5: a schema this module cannot express must produce a JSON
  // editor, not an empty form whose Save can never pass validation.
  it("falls back to a single JSON field for a nested schema", () => {
    const form = buildInputForm(z.object({ nested: z.object({ a: z.string() }) }));
    expect(form.jsonFallback).toBe(true);
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].kind).toBe("json");
  });

  it("falls back for a schema that is not an object at all", () => {
    expect(buildInputForm(z.string()).jsonFallback).toBe(true);
    expect(buildInputForm(z.array(z.string())).jsonFallback).toBe(true);
    expect(buildInputForm(z.union([z.string(), z.number()])).jsonFallback).toBe(true);
  });

  it("falls back for an object with no fields", () => {
    const form = buildInputForm(z.object({}));
    expect(form.jsonFallback).toBe(true);
  });

  it("carries the schema's own description onto the json field", () => {
    const form = buildInputForm(z.string().describe("Free-form payload"));
    expect(form.fields[0].description).toBe("Free-form payload");
  });
});

describe("coerceInputValues", () => {
  const formWith = (schema: Parameters<typeof buildInputForm>[0]) =>
    buildInputForm(schema);

  it("trims strings and reads numbers", () => {
    const form = formWith(z.object({ message: z.string(), count: z.number() }));
    expect(coerceInputValues(form, { message: "  hi  ", count: "3" })).toEqual({
      ok: true,
      value: { message: "hi", count: 3 },
    });
  });

  // Review Focus 2's cousin: an empty number input is a blank string, and
  // `Number("")` is 0 -- so a blank field must be treated as "unset", not as a
  // value the user typed.
  it("reports a message for a blank required field", () => {
    const form = formWith(z.object({ message: z.string() }));
    const result = coerceInputValues(form, { message: "   " });
    expect(result.ok).toBe(false);
  });

  it("reports a message for a number field that is not a number", () => {
    const form = formWith(z.object({ count: z.number() }));
    const result = coerceInputValues(form, { count: "abc" });
    expect(result.ok).toBe(false);
  });

  it("omits a blank optional field rather than sending an empty string", () => {
    const form = formWith(
      z.object({ message: z.string(), note: z.string().optional() }),
    );
    expect(coerceInputValues(form, { message: "hi", note: "" })).toEqual({
      ok: true,
      value: { message: "hi" },
    });
  });

  it("reads a boolean switch", () => {
    const form = formWith(z.object({ dryRun: z.boolean() }));
    expect(coerceInputValues(form, { dryRun: "true" })).toEqual({
      ok: true,
      value: { dryRun: true },
    });
    expect(coerceInputValues(form, { dryRun: "false" })).toEqual({
      ok: true,
      value: { dryRun: false },
    });
  });

  it("parses the JSON field and reports a message for invalid JSON", () => {
    const form = buildInputForm(z.object({ nested: z.object({ a: z.string() }) }));
    expect(coerceInputValues(form, { input: '{"a":"b"}' })).toEqual({
      ok: true,
      value: { a: "b" },
    });
    const bad = coerceInputValues(form, { input: "{oops" });
    expect(bad.ok).toBe(false);
  });

  it("accepts an empty JSON field as an empty object", () => {
    const form = buildInputForm(z.object({ nested: z.object({ a: z.string() }) }));
    expect(coerceInputValues(form, { input: "  " })).toEqual({
      ok: true,
      value: {},
    });
  });
});
