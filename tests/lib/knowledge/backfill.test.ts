import { describe, expect, it } from "vitest";
import { CHAT_DOCUMENT_ATTRIBUTE } from "@/constants/knowledge";
import {
  buildBackfillPageQuery,
  findIndexCountMismatches,
} from "@/lib/knowledge/backfill";

describe("buildBackfillPageQuery", () => {
  it("reads only live chat documents", () => {
    expect(buildBackfillPageQuery()).toEqual({
      type: CHAT_DOCUMENT_ATTRIBUTE,
      isDeleted: false,
    });
  });

  // Paging has to advance by `_id`, the one field the read can order by that
  // never changes. Without the bound, a second page re-reads the first and a
  // corpus larger than one page is never fully migrated.
  it("resumes strictly after the last id it saw", () => {
    expect(buildBackfillPageQuery("doc-7")).toEqual({
      type: CHAT_DOCUMENT_ATTRIBUTE,
      isDeleted: false,
      _id: { $gt: "doc-7" },
    });
  });

  it("treats an empty cursor as the first page, not as a bound", () => {
    expect(buildBackfillPageQuery("")).not.toHaveProperty("_id");
  });
});

describe("findIndexCountMismatches", () => {
  it("reports nothing when every document matches its recorded count", () => {
    expect(
      findIndexCountMismatches([
        { id: "a", indexed: 3, recorded: 3 },
        { id: "b", indexed: 1, recorded: 1 },
      ]),
    ).toEqual([]);
  });

  it("reports a document whose chunk count changed", () => {
    expect(
      findIndexCountMismatches([{ id: "a", name: "handbook.pdf", indexed: 4, recorded: 3 }]),
    ).toEqual([{ id: "a", name: "handbook.pdf", indexed: 4, recorded: 3 }]);
  });

  // A document that never recorded a count cannot be confirmed, and reporting it
  // is the point: silence here would read as a verified migration.
  it("reports a document that has no recorded count at all", () => {
    expect(findIndexCountMismatches([{ id: "a", indexed: 2 }])).toEqual([
      { id: "a", name: undefined, indexed: 2, recorded: null },
    ]);
  });

  it("reports a document that lost every chunk", () => {
    expect(
      findIndexCountMismatches([{ id: "a", indexed: 0, recorded: 5 }]),
    ).toHaveLength(1);
  });
});
