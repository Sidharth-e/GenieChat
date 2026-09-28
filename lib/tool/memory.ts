import { tool } from "langchain";
import * as z from "zod";
export const createSaveMemoryTool = (
  userId: string,
  userName: string = "",
  userEmail: string = "",
) =>
  tool(
    async (input) => {
      try {
        const { MemoryGraphStore } =
          await import("@/lib/memory/graph-store");
        const memoryStore = new MemoryGraphStore();

        const memory = await memoryStore.createMemory({
          userId,
          userName,
          userEmail,
          content: input.content,
        });

        return JSON.stringify({
          success: true,
          message: `Memory saved: "${input.content}"`,
          memory_id: memory.id,
          note: "This information will be remembered in all future conversations.",
        });
      } catch (error) {
        return JSON.stringify({
          error: `Failed to save memory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    {
      name: "save_memory",
      description:
        "Save a fact, preference, instruction, or professional detail to long-term memory. Use this when the user shares personal/professional information, preferences, or asks you to remember something. Examples: 'My name is John', 'I prefer dark mode', 'Always respond in French', 'I am a software developer at Acme'.",
      schema: z.object({
        content: z
          .string()
          .describe(
            "The memory to remember. Be concise but complete. Example: 'User prefers concise responses', 'User's favorite color is blue', or 'User works as a backend engineer'.",
          ),
      }),
    },
  );

export const createEditMemoryTool = (userId: string) =>
  tool(
    async (input) => {
      try {
        const { MemoryGraphStore } =
          await import("@/lib/memory/graph-store");
        const memoryStore = new MemoryGraphStore();

        let existingMemory = null as Awaited<
          ReturnType<typeof memoryStore.getMemory>
        >;

        if (input.memory_id) {
          existingMemory = await memoryStore.getMemory(input.memory_id, userId);
        } else if (input.target_content) {
          const allMemories = await memoryStore.getMemories(userId);
          const target = input.target_content.trim().toLowerCase();
          existingMemory =
            allMemories.find(
              (m) => m.content.trim().toLowerCase() === target,
            ) ||
            allMemories.find(
              (m) =>
                m.content.toLowerCase().includes(target) ||
                target.includes(m.content.toLowerCase()),
            ) ||
            null;
        }

        if (!existingMemory) {
          return JSON.stringify({
            error:
              "Memory not found. Provide a valid memory_id or target_content from an existing memory.",
          });
        }

        const updates: {
          content?: string;
        } = {};

        if (input.content !== undefined) {
          updates.content = input.content.trim();
        }

        const updatedMemory = await memoryStore.updateMemory(
          existingMemory.id,
          userId,
          updates,
        );

        if (!updatedMemory) {
          return JSON.stringify({
            error: `Failed to update memory with id: ${existingMemory.id}`,
          });
        }

        return JSON.stringify({
          success: true,
          message: "Memory updated successfully.",
          memory_id: updatedMemory.id,
          content: updatedMemory.content,
          note: "Memory has been re-indexed for future semantic retrieval.",
        });
      } catch (error) {
        return JSON.stringify({
          error: `Failed to edit memory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    {
      name: "edit_memory",
      description:
        "Update an existing long-term memory entry. Use this when the user asks to correct, refine, or change previously saved personal/professional information, preferences, or instructions.",
      schema: z
        .object({
          memory_id: z
            .string()
            .optional()
            .describe("Optional memory ID to edit (preferred when known)."),
          target_content: z
            .string()
            .optional()
            .describe(
              "Optional current memory content to identify the memory when ID is unknown.",
            ),
          content: z
            .string()
            .optional()
            .describe("Updated memory text. Keep it concise and specific."),
        })
        .refine(
          (data) =>
            data.memory_id !== undefined || data.target_content !== undefined,
          {
            message:
              "Provide memory_id or target_content to locate the memory.",
          },
        )
        .refine((data) => data.content !== undefined, {
          message: "Updated memory text is required.",
        }),
    },
  );

export const createDeleteMemoryTool = (userId: string) =>
  tool(
    async (input) => {
      try {
        const { MemoryGraphStore } =
          await import("@/lib/memory/graph-store");
        const memoryStore = new MemoryGraphStore();

        let existingMemory = null as Awaited<
          ReturnType<typeof memoryStore.getMemory>
        >;

        if (input.memory_id) {
          existingMemory = await memoryStore.getMemory(input.memory_id, userId);
        } else if (input.target_content) {
          const allMemories = await memoryStore.getMemories(userId);
          const target = input.target_content.trim().toLowerCase();
          existingMemory =
            allMemories.find(
              (m) => m.content.trim().toLowerCase() === target,
            ) ||
            allMemories.find(
              (m) =>
                m.content.toLowerCase().includes(target) ||
                target.includes(m.content.toLowerCase()),
            ) ||
            null;
        }

        if (!existingMemory) {
          return JSON.stringify({
            error:
              "Memory not found. Provide a valid memory_id or target_content from an existing memory.",
          });
        }

        const deleted = await memoryStore.deleteMemory(
          existingMemory.id,
          userId,
        );
        if (!deleted) {
          return JSON.stringify({
            error: `Failed to delete memory with id: ${existingMemory.id}`,
          });
        }

        return JSON.stringify({
          success: true,
          message: "Memory deleted successfully.",
          memory_id: existingMemory.id,
          note: "Memory removed from both persistent storage and vector index.",
        });
      } catch (error) {
        return JSON.stringify({
          error: `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    {
      name: "delete_memory",
      description:
        "Delete an existing long-term memory entry. Use this when the user asks to forget or remove previously saved personal information.",
      schema: z
        .object({
          memory_id: z
            .string()
            .optional()
            .describe("Optional memory ID to delete (preferred when known)."),
          target_content: z
            .string()
            .optional()
            .describe(
              "Optional current memory content to identify the memory when ID is unknown.",
            ),
        })
        .refine(
          (data) =>
            data.memory_id !== undefined || data.target_content !== undefined,
          {
            message:
              "Provide memory_id or target_content to locate the memory.",
          },
        ),
    },
  );
