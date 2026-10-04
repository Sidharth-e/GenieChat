import { describe, expect, it } from "vitest";
import { replacePromptVariables } from "@/lib/langchain/langchain-utility";

describe("replacePromptVariables", () => {
  it("substitutes the memory block", () => {
    const result = replacePromptVariables("Memories:\n{user_memories}", {
      memories: ["- I work as a Rust developer"],
    });
    expect(result).toContain("- I work as a Rust developer");
  });

  it("says so plainly when there are no memories", () => {
    const result = replacePromptVariables("{user_memories}", { memories: [] });
    expect(result).toContain("None recorded yet.");
  });

  it("does not let a $ sequence in a fact rewrite the prompt", () => {
    // String.prototype.replace treats `$&`, `$'` and `$1` in the *replacement*
    // as patterns. `$&` inserts the whole match, so a memory containing it
    // multiplies itself; `$'` splices in everything after the placeholder.
    // Passing a function makes the replacement literal.
    const result = replacePromptVariables("A\n{user_memories}\nB", {
      memories: ["- I paid $& for it"],
    });
    expect(result).toBe("A\n- I paid $& for it\nB");
  });

  it("does not expand $' either", () => {
    const result = replacePromptVariables("A\n{user_memories}\nB", {
      memories: ["- trailing $' marker"],
    });
    expect(result).toBe("A\n- trailing $' marker\nB");
  });

  it("keeps a $ sequence out of the user's own name, which is user-supplied too", () => {
    const result = replacePromptVariables("{user_name}", { name: "A$&B" });
    expect(result).toBe("A$&B");
  });

  it("keeps a $ sequence out of the email too", () => {
    const result = replacePromptVariables("{user_email}", {
      email: "a$'b@example.com",
    });
    expect(result).toBe("a$'b@example.com");
  });
});
