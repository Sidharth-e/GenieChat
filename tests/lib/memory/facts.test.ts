import { describe, expect, it } from "vitest";
import {
  decideFactWrite,
  renderRecalledFact,
  selectSuperseded,
  toRecallCandidate,
} from "@/lib/memory/facts";

describe("decideFactWrite", () => {
  const base = {
    predicate: "LIKES",
    operation: "add" as const,
    incomingObjectId: "apple",
    currentFacts: [{ objectId: "apple" }],
  };

  it("is a no-op when the identical fact is already current", () => {
    expect(decideFactWrite(base)).toBe("noop");
  });

  it("inserts a second value for a multi-valued predicate rather than closing the first", () => {
    // "likes apple" then "likes banana" are both true. Closing would lose one.
    expect(
      decideFactWrite({
        ...base,
        incomingObjectId: "banana",
        currentFacts: [{ objectId: "apple" }],
      }),
    ).toBe("insert");
  });

  it("supersedes when the extractor saw a temporal cue", () => {
    expect(
      decideFactWrite({
        ...base,
        operation: "replace",
        incomingObjectId: "rust",
        currentFacts: [{ objectId: "swift" }],
        predicate: "PREFERS",
      }),
    ).toBe("supersede");
  });

  it("supersedes a functional predicate even when the extractor defaulted to add", () => {
    // The under-asserting extractor is the primary risk; this allow-list is the
    // mitigation that does not depend on the model.
    expect(
      decideFactWrite({
        ...base,
        predicate: "WORKS_AS",
        incomingObjectId: "rust",
        currentFacts: [{ objectId: "swift" }],
      }),
    ).toBe("supersede");
  });

  it("still inserts for a functional predicate with nothing current to close", () => {
    expect(
      decideFactWrite({
        ...base,
        predicate: "WORKS_AS",
        incomingObjectId: "rust",
        currentFacts: [],
      }),
    ).toBe("insert");
  });

  it("is a no-op when the object is current, even under replace", () => {
    expect(
      decideFactWrite({
        ...base,
        predicate: "WORKS_AS",
        operation: "replace",
        incomingObjectId: "rust",
        currentFacts: [{ objectId: "rust" }, { objectId: "swift" }],
      }),
    ).toBe("noop");
  });

  it("inserts when nothing is current, even under replace", () => {
    // Only a current fact can be superseded, and the caller passes current facts
    // only — so an empty list means insert no matter what the extractor said.
    expect(
      decideFactWrite({
        ...base,
        operation: "replace",
        incomingObjectId: "rust",
        currentFacts: [],
      }),
    ).toBe("insert");
  });
});

describe("selectSuperseded", () => {
  it("keeps the newest and closes the rest, by createdAt", () => {
    expect(
      selectSuperseded([
        { id: "oldest", createdAt: "2025-01-01T00:00:00.000Z" },
        { id: "newest", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "middle", createdAt: "2025-06-01T00:00:00.000Z" },
      ]),
    ).toEqual(["oldest", "middle"]);
  });

  it("closes nothing for a single fact or none", () => {
    expect(selectSuperseded([{ id: "only", createdAt: "2026-01-01T00:00:00.000Z" }])).toEqual([]);
    expect(selectSuperseded([])).toEqual([]);
  });

  it("does not mutate or reorder the input", () => {
    const facts = [
      { id: "a", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "b", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    selectSuperseded(facts);
    expect(facts.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("toRecallCandidate", () => {
  it("maps the fact's sentence to the ranker's content field", () => {
    const candidate = toRecallCandidate({
      id: "f1",
      sourceText: "I work as a Rust developer",
      createdAt: "2026-01-01T00:00:00.000Z",
      vectorScore: 0.9,
      hops: 0,
      pathWeight: 1,
    });
    expect(candidate.content).toBe("I work as a Rust developer");
    expect(candidate.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(candidate.vectorScore).toBe(0.9);
  });
});

describe("renderRecalledFact", () => {
  it("renders the sentence alone when there is no predecessor", () => {
    expect(renderRecalledFact("I work as Rust now", null)).toBe("I work as Rust now");
  });

  it("appends the predecessor as past, never as current", () => {
    expect(
      renderRecalledFact("I work as Rust now", {
        sourceText: "I work as Swift",
        validTo: "2025-06-14T10:00:00.000Z",
      }),
    ).toBe("I work as Rust now (previously: I work as Swift, until 2025-06)");
  });

  it("omits the date clause rather than printing a malformed one", () => {
    expect(
      renderRecalledFact("current", { sourceText: "old", validTo: "not-a-date" }),
    ).toBe("current (previously: old)");
  });
});
