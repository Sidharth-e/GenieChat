import { logger } from "@/lib/logger";
import { tool, StructuredTool } from "langchain";
import * as z from "zod";
import { CustomTool, CustomToolParameter } from "../types";
import vm from "node:vm";

/**
 * Converts a parameter type string to the corresponding Zod type
 */
function getZodType(paramType: CustomToolParameter["type"]): z.ZodTypeAny {
  switch (paramType) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "object":
      return z.record(z.string(), z.unknown());
    case "array":
      return z.array(z.unknown());
    case "string":
    default:
      return z.string();
  }
}

/**
 * Builds a Zod schema from CustomToolParameter array
 */
/**
 * Builds a Zod schema from CustomToolParameter array or JSON Schema object
 */
function buildSchemaFromParameters(
  parameters: CustomToolParameter[] | unknown,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schemaObj: Record<string, z.ZodTypeAny> = {};

  // Handle case where parameters is a JSON Schema object (legacy/AI generated)
  let paramsList: CustomToolParameter[] = [];

  if (Array.isArray(parameters)) {
    paramsList = parameters;
  } else if (
    parameters &&
    typeof parameters === "object" &&
    "properties" in parameters
  ) {
    // Convert JSON Schema properties to CustomToolParameter array
    logger.warn(
      "Converting JSON Schema parameters to CustomToolParameter array (legacy support)",
    );
    const properties = (parameters as { properties: Record<string, unknown> })
      .properties;
    const requiredRaw = (parameters as { required?: unknown }).required;
    const required = Array.isArray(requiredRaw)
      ? requiredRaw.filter((item): item is string => typeof item === "string")
      : [];

    for (const [key, value] of Object.entries(properties)) {
      const prop =
        value && typeof value === "object"
          ? (value as {
              type?: CustomToolParameter["type"];
              description?: string;
            })
          : {};
      paramsList.push({
        name: key,
        type: prop.type || "string",
        description: prop.description,
        required: required.includes(key),
      });
    }
  }

  for (const param of paramsList) {
    let zodType = getZodType(param.type);

    // Add description if available
    if (param.description) {
      zodType = zodType.describe(param.description);
    }

    // Make optional if not required
    if (!param.required) {
      zodType = zodType.optional();
    }

    schemaObj[param.name] = zodType;
  }

  // If no parameters, add an empty optional field to satisfy langchain requirements
  if (Object.keys(schemaObj).length === 0) {
    schemaObj["_empty"] = z
      .string()
      .optional()
      .describe("No parameters required");
  }

  return z.object(schemaObj);
}

/**
 * Converts a tool name to a valid function name (snake_case)
 */
function toSnakeCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "169.254.169.254",
  "metadata.google.internal",
]);

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (BLOCKED_HOSTS.has(parsed.hostname)) return true;
    if (parsed.hostname.endsWith(".internal")) return true;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return true;
    // Block private IP ranges
    const parts = parsed.hostname.split(".");
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);
      if (first === 10) return true;
      if (first === 172 && second >= 16 && second <= 31) return true;
      if (first === 192 && second === 168) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function createSandboxedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (isBlockedUrl(url)) {
      throw new Error("Blocked: requests to internal/private addresses are not allowed");
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };
}

async function executeCustomCode(
  code: string,
  params: Record<string, unknown>,
  secrets: Record<string, string> = {},
): Promise<unknown> {
  try {
    const MAX_CODE_SIZE = 50_000;
    const EXEC_TIMEOUT_MS = 2_000;

    if (code.length > MAX_CODE_SIZE) {
      throw new Error("Tool code exceeds maximum allowed size");
    }

    const sandboxFetch = createSandboxedFetch();

    const context = vm.createContext(
      {
        params,
        env: Object.freeze({ ...secrets }),
        console: {
          log: (...args: unknown[]) =>
            logger.info({ customToolLogs: args }, "[CustomTool]"),
          warn: (...args: unknown[]) =>
            logger.warn({ customToolLogs: args }, "[CustomTool]"),
          error: (...args: unknown[]) =>
            logger.error({ customToolLogs: args }, "[CustomTool]"),
        },
        fetch: sandboxFetch,
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        encodeURI,
        decodeURI,
        atob: globalThis.atob,
        btoa: globalThis.btoa,
      },
      {
        name: "custom-tool-sandbox",
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      },
    );

    const wrappedCode = `"use strict";
        (async () => {
            ${code}

            // Support generated tools that define async function handle(params) { ... }
            // without explicitly calling it.
            if (typeof handle === "function") {
                return await handle(params);
            }
        })()`;

    const script = new vm.Script(wrappedCode, {
      filename: "custom-tool.js",
    });

    const result = script.runInContext(context, {
      timeout: EXEC_TIMEOUT_MS,
    });

    const timedResult = await Promise.race([
      Promise.resolve(result),
      new Promise<never>((_, reject) =>
        globalThis.setTimeout(
          () =>
            reject(
              new Error(`Tool execution timed out after ${EXEC_TIMEOUT_MS}ms`),
            ),
          EXEC_TIMEOUT_MS,
        ),
      ),
    ]);

    return timedResult;
  } catch (error) {
    logger.error("Error executing custom tool code:", error);
    throw error;
  }
}

/**
 * Converts a single CustomTool from the database to a LangChain StructuredTool
 */
export function convertCustomToolToLangChain(
  customTool: CustomTool,
  secrets: Record<string, string> = {},
): StructuredTool {
  const toolName = toSnakeCase(customTool.name);
  const schema = buildSchemaFromParameters(customTool.parameters);

  return tool(
    async (params: Record<string, unknown>) => {
      try {
        const result = await executeCustomCode(
          customTool.code,
          params,
          secrets,
        );

        // If result is already a string, return it directly
        if (typeof result === "string") {
          return result;
        }

        // If result is an object or has a value, stringify it
        if (result !== undefined && result !== null) {
          return JSON.stringify(result);
        }

        // No result returned - provide a default success message with params
        return JSON.stringify({
          success: true,
          message: "Tool executed successfully",
          input: params,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        return JSON.stringify({
          error: `Tool execution failed: ${errorMessage}`,
          tool: customTool.name,
          input: params,
        });
      }
    },
    {
      name: toolName,
      description: customTool.description || `Custom tool: ${customTool.name}`,
      schema,
    },
  );
}

/**
 * Converts an array of CustomTools to LangChain StructuredTools
 * Only converts enabled tools
 */
export function convertCustomToolsToLangChain(
  customTools: CustomTool[],
  secrets: Record<string, string> = {},
): StructuredTool[] {
  const enabledTools = customTools.filter((t) => t.enabled);

  return enabledTools
    .map((customTool) => {
      try {
        return convertCustomToolToLangChain(customTool, secrets);
      } catch (error) {
        logger.error(
          `Failed to convert custom tool '${customTool.name}':`,
          error,
        );
        return null;
      }
    })
    .filter((t): t is StructuredTool => t !== null);
}

/**
 * Creates a lookup map for custom tools by name
 */
export function createCustomToolsMap(
  customTools: CustomTool[],
  secrets: Record<string, string> = {},
): Map<string, StructuredTool> {
  const map = new Map<string, StructuredTool>();
  const enabledTools = customTools.filter((t) => t.enabled);

  for (const customTool of enabledTools) {
    try {
      const toolName = toSnakeCase(customTool.name);
      const structuredTool = convertCustomToolToLangChain(customTool, secrets);
      map.set(toolName, structuredTool);
    } catch (error) {
      logger.error(
        `Failed to add custom tool '${customTool.name}' to map:`,
        error,
      );
    }
  }

  return map;
}
