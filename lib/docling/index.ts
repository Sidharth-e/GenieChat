/**
 * Public surface for document parsing.
 *
 * `response.ts` is pure and unit-tested; `client.ts` performs I/O and is not.
 * See docs/superpowers/specs/2026-09-24-docling-document-parsing-design.md §1.
 *
 * Re-exported: `convertDocument` and `budgetDocumentText`, which callers outside
 * this module use. `response.ts`'s other helpers (`isTextFile`,
 * `mapConversionResponse`, `errorResult`) are imported from `./response`
 * directly by the files that need them — `client.ts` and the tests — so
 * re-exporting a subset of them here would make "public" mean two things.
 *
 * The two types are the deliberate exception to "only what callers use":
 * `convertDocument` returns `DoclingResult` and produces `ConvertedDocument`, so
 * they describe this surface's own contract even though no caller names them yet.
 */
export { convertDocument } from "./client";
export { budgetDocumentText } from "./response";
export type { ConvertedDocument, DoclingResult } from "./response";
