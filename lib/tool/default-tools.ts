import { tool, StructuredTool } from "langchain";
import * as z from "zod";
import { getModel } from "../langchain/model-factory";
import { config } from "@/lib/config";
import { generateResponseWithUsage } from "../langchain/langchain-utility";
import { createArtifactPayload } from "./artifact-helpers";
import { logger } from "@/lib/logger";

const EXA_TIMEOUT_MS = 60_000;

export const webSearch = tool(
  async (input) => {
    const apiKey = config.exa.apiKey;

    if (!apiKey) {
      return JSON.stringify({
        error:
          "Exa API key not configured. Please set EXA_API_KEY environment variable.",
      });
    }

    try {
      const response = await fetch(`${config.exa.baseUrl}/answer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ query: input.query }),
        signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return JSON.stringify({
          error: `Failed to search: Exa returned ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
        });
      }

      const data = (await response.json()) as {
        answer?: string;
        citations?: { title?: string; url?: string }[];
      };
      const citations = (data.citations ?? [])
        .map((citation) => citation.url)
        .filter((url): url is string => Boolean(url));

      return JSON.stringify({
        answer: data.answer || "No answer found",
        citations,
        query: input.query,
        note:
          citations.length > 0
            ? `Found ${citations.length} source(s). Citations are numbered [1], [2], etc. in the answer.`
            : "No citations available for this query.",
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to search: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "web_search",
    description:
      "Search the real-time internet. Use this for: 1) News and current events. 2) Facts you are unsure about. 3) Specific information (scores, stock prices, checking facts). Do NOT use for general knowledge you already have.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "The search query. Be specific! (e.g. 'current apple stock price' instead of 'apple')",
        ),
    }),
  },
);

export const generateMermaid = tool(
  async (input) => {
    try {
      const model = getModel(config.defaultToolConfig.mermaid.model, {
        temperature: config.defaultToolConfig.mermaid.temperature,
      });
      const prompt = `You are an expert at generating Mermaid diagrams.
Generate a Complex Mermaid diagram for the following description: ${input.description}

Return ONLY the mermaid code. Do not include markdown formatting (like \`\`\`mermaid) surrounding the code, just the raw code.
Ensure the diagram is syntactically correct and uses appropriate directions (usually TD or LR) and shapes.
If the description implies a specific type (sequence, class, state, etc.), use that. Otherwise choose the best fit.
Complex diagrams should include subgraphs, styling, and detailed relationships where appropriate.

CRITICAL SYNTAX RULES — you MUST follow these to avoid parse errors:
1. NEVER use HTML tags inside node labels (no <br/>, <b>, <i>, <br>, <span>, etc.). They cause parse errors.
2. ALWAYS double-quote any label that contains special characters like parentheses, ampersands, colons, semicolons, angle brackets, or slashes. Example: A["Weights (w) & Bias (b)"] NOT A[Weights (w) & Bias (b)].
3. For multi-line labels, use quoted labels with \\n instead of <br/>. Example: A["Line 1\\nLine 2"].
4. Escape any literal double-quote inside a quoted label with #quot;.
5. Do NOT use unicode special characters or emoji in labels.
6. Keep node labels short and concise to prevent text from overflowing its shape. Use \\n to break long text into multiple shorter lines.`;

      const { content, tokens: _tokens } = await generateResponseWithUsage(
        prompt,
        input.description,
        model,
      );

      // Strip markdown if the model included it despite instructions
      let cleanedContent = content.trim();
      const match = cleanedContent.match(
        /^```(?:mermaid)?\n?([\s\S]*?)\n?```$/,
      );
      if (match) {
        cleanedContent = match[1].trim();
      } else {
        cleanedContent = cleanedContent
          .replace(/^```[a-zA-Z]*\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
      }

      return JSON.stringify({
        mermaid_code: cleanedContent,
        note: "IMPORTANT: You MUST display this diagram to the user. To do so, you MUST output a markdown code block with the language 'mermaid' containing the raw code. Example:\n```mermaid\ngraph TD\nA-->B\n```",
        _tokens,
        _artifact: createArtifactPayload(
          "mermaid",
          "Mermaid Diagram",
          cleanedContent,
          "mmd",
          { code: cleanedContent },
        ),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to generate diagram: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "generate_mermaid",
    description:
      "Create a Mermaid diagram (flowcharts, sequence, class, state, ER, Gantt). Use for structural or relational visualizations. For numeric data charts (bar, line, pie), use generate_chart instead.",
    schema: z.object({
      description: z
        .string()
        .describe(
          "A detailed description of the diagram. specific node names, connections, and flow.",
        ),
    }),
  },
);

export const generateChart = tool(
  async (input) => {
    try {
      const model = getModel(config.defaultToolConfig.chart.model, {
        temperature: config.defaultToolConfig.chart.temperature,
      });
      const prompt = `You are an expert at generating Recharts configurations.
Generate a JSON configuration for a chart based on this description: ${input.description}

The JSON must strictly follow this schema:
{
  "type": "line" | "bar" | "area" | "pie",
  "title": string,
  "description": string,
  "data": Array<Object>,
  "xAxisKey": string (key for x-axis),
  "series": Array<{
    "dataKey": string (key for value),
    "name": string (label),
    "color": string (hex code),
    "stackId": string (optional)
  }>
}

Return ONLY the raw JSON string. Do not include markdown formatting (like \`\`\`json) surrounding the code.
If specific data values are not provided in the description, generate realistic simulation data to demonstrate the chart.`;

      const { content, tokens: _tokens } = await generateResponseWithUsage(
        prompt,
        input.description,
        model,
      );
      // Strip markdown if present
      let cleanedContent = content.trim();
      const match = cleanedContent.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
      if (match) {
        cleanedContent = match[1].trim();
      } else {
        cleanedContent = cleanedContent
          .replace(/^```[a-zA-Z]*\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
      }

      const chartConfig = JSON.parse(cleanedContent);

      return JSON.stringify({
        chart_config: chartConfig,
        note: 'IMPORTANT: You MUST display this chart to the user. To do so, you MUST output a markdown code block with the language \'chart\' containing the raw JSON. Example:\n```chart\n{"type": "bar", ...}\n```',
        _tokens,
        _artifact: createArtifactPayload(
          "chart",
          chartConfig.title || "Chart",
          cleanedContent,
          "json",
          { config: chartConfig },
        ),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to generate chart: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "generate_chart",
    description:
      "Create a numeric data chart (Bar, Line, Area, Pie) for statistics, trends, or quantitative comparisons. For structural diagrams (flowcharts, sequences), use generate_mermaid instead.",
    schema: z.object({
      description: z
        .string()
        .describe(
          "Description of the data to chart. Include what the axes should be and the general trend/values if known.",
        ),
    }),
  },
);

export const generateCanvas = tool(
  async (input) => {
    try {
      const model = getModel(config.defaultToolConfig.chart.model, {
        temperature: config.defaultToolConfig.chart.temperature,
      });

      const hasExistingCode = !!input.existing_code?.trim();

      const prompt = hasExistingCode
        ? `You are an expert React UI engineer.
The user wants to MODIFY an existing React component. Here is the current code:

\`\`\`tsx
${input.existing_code}
\`\`\`

Apply the following changes: ${input.description}

Requirements:
- Return the COMPLETE updated component code (not a diff or partial snippet).
- Return ONLY raw React component code (no markdown fences).
- Preserve all existing functionality, structure, and styling that the user did NOT ask to change.
- Export a default component.
- Use Tailwind CSS utility classes for styling.
- Keep the code self-contained with no local project imports.
- Allowed external libraries: lucide-react, recharts, framer-motion.
- Prefer JSX that runs directly in a browser preview environment.
- If interactivity is needed, use React hooks in the component.
`
        : `You are an expert React UI engineer.
Generate a single, complete React component based on this description: ${input.description}

Requirements:
- Return ONLY raw React component code (no markdown fences).
- Export a default component.
- Use Tailwind CSS utility classes for styling.
- Keep the code self-contained with no local project imports.
- Allowed external libraries: lucide-react, recharts, framer-motion.
- Prefer JSX that runs directly in a browser preview environment.
- If interactivity is needed, use React hooks in the component.
`;

      const { content, tokens: _tokens } = await generateResponseWithUsage(
        prompt,
        input.description,
        model,
      );

      let cleanedContent = content.trim();
      const match = cleanedContent.match(
        /^```(?:tsx|jsx|react|react-canvas)?\n?([\s\S]*?)\n?```$/,
      );
      if (match) {
        cleanedContent = match[1].trim();
      } else {
        cleanedContent = cleanedContent
          .replace(/^```[a-zA-Z-]*\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
      }

      return JSON.stringify({
        react_canvas_code: cleanedContent,
        note: "The React component has been saved as an artifact. A preview card is shown automatically — do NOT output the code in a react-canvas code block. Instead, briefly describe what the component does and its key features.",
        _tokens,
        _artifact: createArtifactPayload(
          "canvas",
          "Canvas Component",
          cleanedContent,
          "tsx",
          { code: cleanedContent },
        ),
      });
    } catch (error) {
      return JSON.stringify({
        error: `Failed to generate canvas component: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "generate_canvas",
    description:
      "Create or modify an interactive React component for Canvas preview. Use ONLY for functional web UIs: mockups, widgets, dashboards. Never for text content, emails, reports, or general output. When the user wants to change an existing canvas, pass the current code in existing_code so changes are applied incrementally instead of regenerating from scratch.",
    schema: z.object({
      description: z
        .string()
        .describe(
          "Detailed description of the UI/component to generate, or the specific changes to apply when modifying an existing component.",
        ),
      existing_code: z
        .string()
        .optional()
        .describe(
          "The current React component code from the most recent canvas version. Pass this when the user wants to modify, update, or iterate on an existing canvas component. Omit when creating a brand new component.",
        ),
    }),
  },
);

export function createGenerateCanvasTool(messages: Message[]) {
  return tool(
    async (input) => {
      let existingCode = input.existing_code?.trim() || null;

      if (!existingCode) {
        existingCode = extractLatestCanvasCode(messages);
        logger.info(
          `[generate_canvas] Auto-injected existing_code from history: ${existingCode ? `${existingCode.length} chars` : "none found"}`,
        );
      }

      try {
        const model = getModel(config.defaultToolConfig.chart.model, {
          temperature: config.defaultToolConfig.chart.temperature,
        });

        const prompt = existingCode
          ? `You are an expert React UI engineer.
The user wants to MODIFY an existing React component. Here is the current code:

\`\`\`tsx
${existingCode}
\`\`\`

Apply the following changes: ${input.description}

Requirements:
- Return the COMPLETE updated component code (not a diff or partial snippet).
- Return ONLY raw React component code (no markdown fences).
- Preserve all existing functionality, structure, and styling that the user did NOT ask to change.
- Export a default component.
- Use Tailwind CSS utility classes for styling.
- Keep the code self-contained with no local project imports.
- Allowed external libraries: lucide-react, recharts, framer-motion.
- Prefer JSX that runs directly in a browser preview environment.
- If interactivity is needed, use React hooks in the component.
`
          : `You are an expert React UI engineer.
Generate a single, complete React component based on this description: ${input.description}

Requirements:
- Return ONLY raw React component code (no markdown fences).
- Export a default component.
- Use Tailwind CSS utility classes for styling.
- Keep the code self-contained with no local project imports.
- Allowed external libraries: lucide-react, recharts, framer-motion.
- Prefer JSX that runs directly in a browser preview environment.
- If interactivity is needed, use React hooks in the component.
`;

        const { content, tokens: _tokens } = await generateResponseWithUsage(
          prompt,
          input.description,
          model,
        );

        let cleanedContent = content.trim();
        const match = cleanedContent.match(
          /^```(?:tsx|jsx|react|react-canvas)?\n?([\s\S]*?)\n?```$/,
        );
        if (match) {
          cleanedContent = match[1].trim();
        } else {
          cleanedContent = cleanedContent
            .replace(/^```[a-zA-Z-]*\n?/, "")
            .replace(/\n?```$/, "")
            .trim();
        }

        return JSON.stringify({
          react_canvas_code: cleanedContent,
          note: "The React component has been saved as an artifact. A preview card is shown automatically — do NOT output the code in a react-canvas code block. Instead, briefly describe what the component does and its key features.",
          _tokens,
          _artifact: createArtifactPayload(
            "canvas",
            "Canvas Component",
            cleanedContent,
            "tsx",
            { code: cleanedContent },
          ),
        });
      } catch (error) {
        return JSON.stringify({
          error: `Failed to generate canvas component: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    {
      name: "generate_canvas",
      description:
        "Create or modify an interactive React component for Canvas preview. Use ONLY for functional web UIs: mockups, widgets, dashboards. Never for text content, emails, reports, or general output. When the user wants to change an existing canvas, just describe the changes — the tool automatically receives the current code.",
      schema: z.object({
        description: z
          .string()
          .describe(
            "Detailed description of the UI/component to generate, or the specific changes to apply when modifying an existing component.",
          ),
        existing_code: z
          .string()
          .optional()
          .describe(
            "The current React component code from the most recent canvas version. Pass this when the user wants to modify, update, or iterate on an existing canvas component. Omit when creating a brand new component.",
          ),
      }),
    },
  );
}

export const knowledgeBaseSearch = tool(
  async (input) => {
    try {
      const { VectorAgentDocumentStore } =
        await import("@/lib/azure-ai-search/vector-agent-document-store");
      const store = new VectorAgentDocumentStore();

      let filter = undefined;
      if (input.agentId) {
        filter = `agentId eq '${input.agentId}'`;
      }

      const result = await store.searchDocuments(input.query, filter, 5);

      if (result.status === "OK") {
        const docs = result.response;
        if (!docs || docs.length === 0) {
          return JSON.stringify({
            message: "No relevant documents found in the knowledge base.",
          });
        }

        const formattedResults = docs.map((d) => ({
          title: d.document.title,
          content: d.document.content,
          score: d.score,
        }));

        return JSON.stringify({
          results: formattedResults,
        });
      } else {
        const errorMessage = JSON.stringify(result.errors);
        // Handle the specific error where agentId doesn't exist in the index yet
        if (
          errorMessage.includes("Could not find a property named 'agentId'")
        ) {
          return JSON.stringify({
            error:
              "Search failed: The knowledge base index is outdated. Please ask the user to re-upload their documents to fix this issue.",
          });
        }

        return JSON.stringify({
          error: `Search failed: ${errorMessage}`,
        });
      }
    } catch (error) {
      return JSON.stringify({
        error: `Failed to search knowledge base: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  {
    name: "knowledge_base_search",
    description:
      "Search the User's uploaded documents/knowledge base. Use this when the user asks about their own files, specific policies, uploaded reports, or any context that is unique to them.",
    schema: z.object({
      query: z
        .string()
        .describe("The search terms to find relevant documents."),
      agentId: z
        .string()
        .optional()
        .describe(
          "The specific Agent ID if known/applicable, to filter results.",
        ),
    }),
  },
);

export const createUseSkillTool = (
  skills: { name: string; description: string; instructions: string }[],
) => {
  const skillNames = skills.map((s) => s.name);
  return tool(
    async (input) => {
      const match = skills.find(
        (s) => s.name.toLowerCase() === input.skill_name.toLowerCase(),
      );
      if (!match) {
        return JSON.stringify({
          error: `Skill "${input.skill_name}" not found. Available skills: ${skillNames.join(", ")}`,
        });
      }
      return JSON.stringify({
        skill: match.name,
        instructions: match.instructions,
      });
    },
    {
      name: "use_skill",
      description:
        "Activate a skill to receive its full instructions. Call this when a user's request matches one of your available skills. Pass the exact skill name.",
      schema: z.object({
        skill_name: z
          .string()
          .describe(
            `The name of the skill to activate. Available: ${skillNames.join(", ")}`,
          ),
      }),
    },
  );
};

import { extractLatestCanvasCode } from "./canvas-utils";
import { Message } from "@/lib/types";

export const defaultTools = [
  webSearch,
  knowledgeBaseSearch,
  generateMermaid,
  generateChart,
  generateCanvas,
];

const defaultToolsMap: Record<string, StructuredTool> = {
  web_search: webSearch,
  knowledge_base_search: knowledgeBaseSearch,
  generate_mermaid: generateMermaid,
  generate_chart: generateChart,
  generate_canvas: generateCanvas,
};

export default defaultToolsMap;
