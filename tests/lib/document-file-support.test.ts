import { describe, it, expect } from "vitest";
import {
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_FORMATS_LABEL,
  getFileExtension,
  isSupportedDocumentFile,
} from "@/lib/document-file-support";

/**
 * The advertised format contract is pure logic that four call sites read, so it
 * gets the unit test the repo convention requires. The contract has drifted
 * from reality twice — HEIF/HEIC and the legacy Office trio were both
 * advertised while being unreadable — and nothing failed either time. These
 * assertions are the guard that was missing.
 */

/** A file as the upload routes pass it: a name and an optional declared MIME. */
function file(name: string, type?: string | null) {
  return { name, type };
}

describe("isSupportedDocumentFile", () => {
  it.each([
    ["report.pdf", "application/pdf"],
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["notes.txt", "text/plain"],
    ["notes.md", "text/markdown"],
    ["data.json", "application/json"],
    ["page.html", "text/html"],
    ["scan.tiff", "image/tiff"],
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["diagram.bmp", "image/bmp"],
  ])("accepts %s (%s)", (name, type) => {
    expect(isSupportedDocumentFile(file(name, type))).toBe(true);
  });

  it.each([
    ["photo.heic", "image/heic"],
    ["photo.heif", "image/heif"],
    ["old.doc", "application/msword"],
    ["old.xls", "application/vnd.ms-excel"],
    ["old.ppt", "application/vnd.ms-powerpoint"],
  ])("rejects %s (%s)", (name, type) => {
    expect(isSupportedDocumentFile(file(name, type))).toBe(false);
  });

  it("rejects both removed groups when no usable MIME is declared", () => {
    // The removed entries must not survive via the extension fall-through.
    for (const name of ["photo.heic", "photo.heif", "old.doc", "old.xls", "old.ppt"]) {
      expect(isSupportedDocumentFile(file(name))).toBe(false);
      expect(isSupportedDocumentFile(file(name, null))).toBe(false);
      expect(isSupportedDocumentFile(file(name, ""))).toBe(false);
      expect(isSupportedDocumentFile(file(name, "application/octet-stream"))).toBe(false);
    }
  });

  it("still accepts a CSV carrying the MIME Windows clients send for .xls", () => {
    // The reason `application/vnd.ms-excel` could be removed safely: the MIME
    // check misses, and the extension fall-through catches `.csv`.
    expect(isSupportedDocumentFile(file("data.csv", "application/vnd.ms-excel"))).toBe(true);
    expect(isSupportedDocumentFile(file("data.csv", "text/csv"))).toBe(true);
    expect(isSupportedDocumentFile(file("data.csv"))).toBe(true);
    expect(isSupportedDocumentFile(file("DATA.CSV", "application/vnd.ms-excel"))).toBe(true);
  });

  it("trusts a declared MIME over the extension — a known limitation, not support", () => {
    // MIME-first validation means a mislabelled file is accepted on its
    // declaration alone and then fails downstream, exactly as silently as
    // before this change. Inherent to the check's order, recorded so it cannot
    // be mistaken for HEIC or legacy Office support.
    expect(isSupportedDocumentFile(file("a.heic", "image/tiff"))).toBe(true);
    expect(isSupportedDocumentFile(file("a.doc", "application/pdf"))).toBe(true);
  });

  it("ignores MIME parameters and casing", () => {
    expect(isSupportedDocumentFile(file("report.pdf", "application/pdf; charset=utf-8"))).toBe(true);
    expect(isSupportedDocumentFile(file("report.pdf", "Application/PDF"))).toBe(true);
  });
});

describe("getFileExtension", () => {
  it.each([
    ["report.pdf", ".pdf"],
    ["ARCHIVE.PDF", ".pdf"],
    ["a.b.c", ".c"],
    ["noext", ""],
    [".hidden", ""],
    ["trailing.", ""],
  ])("maps %s to %s", (name, expected) => {
    expect(getFileExtension(name)).toBe(expected);
  });
});

describe("the advertised contract", () => {
  it("names no format the parser cannot read", () => {
    const advertised = `${SUPPORTED_DOCUMENT_ACCEPT} ${SUPPORTED_DOCUMENT_FORMATS_LABEL}`;
    expect(advertised).not.toMatch(/heic|heif/i);
    // `\b` keeps `.docx`/`.xlsx`/`.pptx` out of these, since `x` is a word char.
    expect(SUPPORTED_DOCUMENT_ACCEPT).not.toMatch(/\.doc\b|\.xls\b|\.ppt\b/);
  });

  it("keeps the OOXML formats the LibreOffice layer exists to serve", () => {
    expect(SUPPORTED_DOCUMENT_ACCEPT).toContain(".docx");
    expect(SUPPORTED_DOCUMENT_ACCEPT).toContain(".xlsx");
    expect(SUPPORTED_DOCUMENT_ACCEPT).toContain(".pptx");
    expect(SUPPORTED_DOCUMENT_FORMATS_LABEL).toContain("Word, Excel, PowerPoint");
  });

  it("is a well-formed accept string with no empty, doubled or trailing tokens", () => {
    expect(SUPPORTED_DOCUMENT_ACCEPT).not.toMatch(/\s/);
    expect(SUPPORTED_DOCUMENT_ACCEPT).not.toMatch(/,\s*,|^,|,$/);

    const tokens = SUPPORTED_DOCUMENT_ACCEPT.split(",");
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token).toMatch(/^\.[a-z0-9]+$/);
    }
  });

  it("has a label with no dangling separator", () => {
    expect(SUPPORTED_DOCUMENT_FORMATS_LABEL).not.toMatch(/\/\s*$|\/\/|,\s*$/);
  });

  it("agrees with what the predicate actually accepts", () => {
    // The contract is only honest if the two halves match: every advertised
    // extension must be accepted by the predicate itself.
    for (const token of SUPPORTED_DOCUMENT_ACCEPT.split(",")) {
      expect(isSupportedDocumentFile(file(`sample${token}`))).toBe(true);
    }
  });
});
