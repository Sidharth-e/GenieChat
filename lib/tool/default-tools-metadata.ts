export interface ToolMetadata {
    name: string;
    description: string;
    alwaysEnabled?: boolean;
}

/**
 * The app tools a workflow Tool node can resolve by name. Hand-written beside
 * the catalogue below rather than derived from it, because `DEFAULT_TOOLS_METADATA`
 * is shared with the agent surfaces and advertises entries no `default:`-prefixed
 * resolver can produce: `get_weather` and `encode_base64` have no implementation
 * at all, and `use_skill` is constructed per agent from that agent's own skills.
 * `resolveDefaultTool` re-exports this beside itself, and a drift test asserts
 * every name here resolves.
 *
 * `knowledge_base_search` resolves but is deliberately absent: it needs the
 * model to supply an `agentId`, which a workflow run has no context for, so it
 * returns an error payload the node reports as a successful output. Offering it
 * to a workflow advertises a tool that can only appear to work.
 *
 * `generate_image` and `generate_video` are absent for a different reason: both
 * resolve and would produce their media, but they deliver it through the
 * artifact envelope and a markdown image or fence, and a workflow run does
 * neither — it never reads the envelope and has no conversation to render into.
 * The picture or clip would be paid for and then dropped. They stay available to
 * the chat and agent surfaces, which do both.
 */
export const RESOLVABLE_DEFAULT_TOOLS: readonly string[] = [
  "web_search",
  "code_sandbox",
];

export const DEFAULT_TOOLS_METADATA: ToolMetadata[] = [
    {
        name: "get_weather",
        description: "Get the current weather at a location.",
    },
    {
        name: "web_search",
        description: "Search the web for current, real-time information.",
    },
    {
        name: "knowledge_base_search",
        description: "Search the agent's knowledge base for stored documents.",
        alwaysEnabled: true,
    },

    {
        name: "encode_base64",
        description: "Encode text to Base64 or decode Base64 to text.",
    },
    {
        name: "use_skill",
        description: "Dynamically activate an agent skill to receive its full instructions. Auto-registered when an agent has skills configured.",
        alwaysEnabled: true,
    },
    {
        name: "code_sandbox",
        description: "Execute Python code or bash commands inside a stateful, sandboxed Linux container for computation, data analysis, and file operations.",
    },
    {
        name: "generate_image",
        description: "Generate an image from a text prompt and render it in the conversation.",
    },
    {
        name: "generate_video",
        description: "Generate a short video clip from a text prompt and render it in the conversation. Slow — the provider runs generation as a job.",
    },
];
