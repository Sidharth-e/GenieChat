import { describe, it, expect } from "vitest";
import {
  budgetDocumentText,
  errorResult,
  isTextFile,
  mapConversionResponse,
} from "@/lib/docling/response";

/** Builds a docling-serve response body. Factory, not an inline literal. */
function doclingBody(overrides: {
  status?: string;
  md?: string | null;
  pages?: Record<string, unknown> | null;
  errors?: Array<{
    error_message?: string | null;
    component_type?: string;
    module_name?: string;
  }> | null;
} = {}) {
  return {
    status: overrides.status ?? "success",
    document: {
      filename: "report.pdf",
      md_content: overrides.md === undefined ? "# Heading\n\nBody text." : overrides.md,
      json_content:
        overrides.pages === undefined
          ? { pages: { "1": {}, "2": {} } }
          : overrides.pages === null
            ? {}
            : { pages: overrides.pages },
    },
    errors: overrides.errors ?? [],
  };
}

describe("mapConversionResponse", () => {
  it("returns the markdown as a single-element array", () => {
    const result = mapConversionResponse(doclingBody(), "report.pdf");
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.response.documents).toEqual(["# Heading\n\nBody text."]);
    // A `success` is a complete conversion, so nothing is marked partial.
    expect(result.partial).toBe(false);
  });

  it("carries the caller's file name through", () => {
    const result = mapConversionResponse(doclingBody(), "named.pdf");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.response.filename).toBe("named.pdf");
  });

  it("counts pages from json_content.pages", () => {
    const result = mapConversionResponse(
      doclingBody({ pages: { "1": {}, "2": {}, "3": {} } }),
      "report.pdf",
    );
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.response.totalPages).toBe(3);
  });

  it("accepts partial_success as usable", () => {
    const result = mapConversionResponse(
      doclingBody({ status: "partial_success" }),
      "report.pdf",
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    // Usable, but flagged: the service reported only a partial status, so this
    // extract may be incomplete and must not reach the user as the whole
    // document.
    expect(result.partial).toBe(true);
  });

  it("treats failure as an error even when text came back", () => {
    const result = mapConversionResponse(
      doclingBody({ status: "failure", md: "partial text" }),
      "report.pdf",
    );
    expect(result.status).toBe("ERROR");
  });

  it("treats skipped as an error", () => {
    // The `skipped` + populated `error_message` shape is the **format
    // rejection**: a real MS Word 97 `.doc` returned exactly this against both
    // the derived and the upstream image.
    //
    // It is NOT the page-cap shape. The cap is `status: "failure"` with 0 pages
    // and 0 `md_content` chars — measured on three fixtures and confirmed at
    // source level — so `skipped` is a different failure with a different
    // signature. `errors` is never populated on a total parse failure, so the
    // mapper synthesises its message from `status`; the `errors: []` that rides
    // in the cap's envelope is no counterexample, and this case passes because
    // the status is reported either way.
    //
    // `partial_success` is the one status still never observed on real traffic.
    const result = mapConversionResponse(
      doclingBody({
        status: "skipped",
        errors: [
          {
            component_type: "user_input",
            module_name: "",
            error_message: "File format not allowed: probe.doc",
          },
        ],
      }),
      "probe.doc",
    );
    if (result.status !== "ERROR") throw new Error("expected ERROR");
    expect(result.errors[0].message).toContain("skipped");
    expect(result.errors[0].message).toContain("File format not allowed");
  });

  it("reports the upstream error messages", () => {
    const result = mapConversionResponse(
      doclingBody({
        status: "failure",
        md: null,
        errors: [{ error_message: "unsupported format" }],
      }),
      "report.pdf",
    );
    if (result.status !== "ERROR") throw new Error("expected ERROR");
    expect(result.errors[0].message).toContain("unsupported format");
  });

  it("errors when success carries no markdown", () => {
    const result = mapConversionResponse(doclingBody({ md: "   " }), "report.pdf");
    expect(result.status).toBe("ERROR");
  });

  it("errors when the status is missing", () => {
    const result = mapConversionResponse(
      { document: { md_content: "text" } },
      "report.pdf",
    );
    expect(result.status).toBe("ERROR");
  });

  it("errors on a non-object body", () => {
    expect(mapConversionResponse("not json", "report.pdf").status).toBe("ERROR");
    expect(mapConversionResponse(null, "report.pdf").status).toBe("ERROR");
  });

  it("falls back to 1 page when json_content is absent", () => {
    const result = mapConversionResponse(
      doclingBody({ pages: null }),
      "report.pdf",
    );
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.response.totalPages).toBe(1);
  });

  it("falls back to 1 page when pages is empty", () => {
    const result = mapConversionResponse(doclingBody({ pages: {} }), "report.pdf");
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.response.totalPages).toBe(1);
  });

  it("trims surrounding whitespace from the markdown", () => {
    const result = mapConversionResponse(
      doclingBody({ md: "\n\n  Hello  \n\n" }),
      "report.pdf",
    );
    if (result.status !== "OK") throw new Error("expected OK");
    expect(result.response.documents).toEqual(["Hello"]);
  });
});

describe("isTextFile", () => {
  it("accepts by extension when the MIME type is wrong", () => {
    expect(isTextFile("notes.md", "application/octet-stream")).toBe(true);
  });

  it("accepts by MIME type when the extension is absent", () => {
    expect(isTextFile("notes", "text/plain")).toBe(true);
  });

  it("matches the MIME type case-insensitively", () => {
    expect(isTextFile("notes", "Text/Plain")).toBe(true);
  });

  it("rejects a binary document", () => {
    expect(isTextFile("report.pdf", "application/pdf")).toBe(false);
  });

  it("does not treat .jsonl as JSON", () => {
    expect(isTextFile("data.jsonl", "application/octet-stream")).toBe(false);
  });

  it("rejects an empty name and type", () => {
    expect(isTextFile("", "")).toBe(false);
  });
});

describe("budgetDocumentText", () => {
  it("returns the text unchanged when inside the budget", () => {
    const result = budgetDocumentText("short", 1000, "a.pdf");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("short");
  });

  it("truncates and marks the result when over budget", () => {
    // 10 tokens x 4 chars/token = 40 characters of the original kept.
    const head = "x".repeat(40);
    const result = budgetDocumentText("x".repeat(100), 10, "a.pdf");
    expect(result.truncated).toBe(true);
    // The budgeted window survives...
    expect(result.text.startsWith(head)).toBe(true);
    // ...and nothing from beyond it does, so no run of x's exceeds it. This is
    // the body assertion the total-length form was standing in for: the notice
    // is appended after the head, so a total length says nothing about how much
    // of the document was kept.
    expect(result.text).not.toContain("x".repeat(41));
    // And the notice is appended after the head, naming the document.
    expect(result.text.slice(head.length)).toContain("a.pdf");
  });

  it("names the document in the truncation notice", () => {
    const result = budgetDocumentText("x".repeat(100), 10, "report.pdf");
    expect(result.text).toContain("report.pdf");
  });

  it("breaks on a line boundary rather than mid-line", () => {
    const text = `${"a".repeat(30)}\n${"b".repeat(30)}`;
    const result = budgetDocumentText(text, 8, "a.pdf");
    expect(result.text.startsWith("a".repeat(30))).toBe(true);
    expect(result.text).not.toContain("b".repeat(30));
  });
});

describe("errorResult", () => {
  it("builds the error arm both modules share", () => {
    expect(errorResult("boom")).toEqual({
      status: "ERROR",
      errors: [{ message: "boom" }],
    });
  });
});
