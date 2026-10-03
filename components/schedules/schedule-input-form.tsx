"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { InputField } from "@/lib/schedules/input-form";

interface ScheduleInputFormProps {
  fields: InputField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  idPrefix: string;
}

/**
 * The target's input, rendered from its schema.
 *
 * Every field is a string in and a string out, because that is what an input
 * element gives -- `coerceInputValues` is what turns them back into the shapes the
 * schema expects, and it is where a blank number field is kept from becoming `0`.
 */
export function ScheduleInputForm({
  fields,
  values,
  onChange,
  idPrefix,
}: ScheduleInputFormProps) {
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const value = values[field.name] ?? "";

        return (
          <div key={field.name} className="space-y-1">
            <label htmlFor={id} className="text-xs text-text-secondary">
              {field.label}
              {!field.required && <span className="ml-1 opacity-60">(optional)</span>}
            </label>

            {field.kind === "textarea" && (
              <Textarea
                id={id}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                placeholder={field.placeholder}
              />
            )}

            {field.kind === "json" && (
              <Textarea
                id={id}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                placeholder='{"key": "value"}'
                className="min-h-32 font-mono text-xs"
                spellCheck={false}
              />
            )}

            {field.kind === "text" && (
              <Input
                id={id}
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                placeholder={field.placeholder}
              />
            )}

            {field.kind === "number" && (
              <Input
                id={id}
                type="number"
                value={value}
                onChange={(e) => onChange(field.name, e.target.value)}
                placeholder={field.placeholder}
              />
            )}

            {field.kind === "boolean" && (
              <Select
                id={id}
                value={value || "false"}
                onChange={(next) => onChange(field.name, next)}
                options={[
                  { value: "false", label: "No" },
                  { value: "true", label: "Yes" },
                ]}
                size="sm"
              />
            )}

            {field.description && (
              <p className="text-xs text-text-secondary">{field.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
