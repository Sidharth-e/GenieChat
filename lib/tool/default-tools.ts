import { tool, StructuredTool } from "langchain";
import * as z from "zod";
import { config } from "@/lib/config";
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

export const defaultTools = [
  webSearch,
  knowledgeBaseSearch,
];

const defaultToolsMap: Record<string, StructuredTool> = {
  web_search: webSearch,
  knowledge_base_search: knowledgeBaseSearch,
};

export default defaultToolsMap;
