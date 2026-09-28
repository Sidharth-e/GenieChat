export interface ToolMetadata {
    name: string;
    description: string;
    alwaysEnabled?: boolean;
}

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
];
