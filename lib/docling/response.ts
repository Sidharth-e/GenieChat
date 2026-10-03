/**
 * Pure mapping from a docling-serve conversion response to the shape the
 * existing call sites already destructure.
 *
 * Imports neither `@/lib/config` nor `@/lib/env`, so it is testable without
 * environment configuration — the same split as `lib/storage/ref.ts` against
 * `lib/storage/s3-client.ts`.
 *
 * See docs/superpowers/specs/2026-09-24-docling-document-parsing-design.md §2.
 */

/** The success payload. Carries the file name alongside the extracted text so
 *  both call sites are served by one shape. */
export interface ConvertedDocument {
  /**
   * Docling's Markdown, wrapped as a single element so every existing
   * `documents.join(…)` call site is unchanged. See spec §2.
   */
  documents: string[];
  totalPages: number;
  filename: string;
}

export type DoclingResult =
  | { status: "OK"; response: ConvertedDocument; partial: boolean }
  | { status: "ERROR"; errors: { message: string }[] };

/** The subset of `ConvertDocumentResponse` this app reads. */
interface DoclingConversionResponse {
  document?: {
    md_content?: string | null;
    json_content?: { pages?: Record<string, unknown> | null } | null;
  } | null;
  status?: string | null;
  errors?: Array<{ error_message?: string | null }> | null;
}

/** The one page count used when Docling reports none. */
const FALLBACK_PAGE_COUNT = 1;

/**
 * Rough characters per token, **measured** rather than assumed.
 *
 * There is no tokenizer dependency in this project and adding one for a prompt
 * guard is not justified, so this stays a constant — but a calibrated one. The
 * figures below come from a local tokenizer (`gemma4:e2b-mlx`, on-device, via
 * Ollama's `prompt_eval_count`); the app's chat model may differ.
 *
 * - **English prose, with this app's Markdown intact, lands at 3.7-4.0.** Repo
 *   documentation measured 3.74 as written and 3.97 with heading, list and table
 *   syntax stripped, so structure costs about 6% and 4 is right for prose.
 * - **A real financial-statement extract measured 1.45** across its first 30,000
 *   characters — a digit-dense document whose window held no tables and no
 *   headings at all. Markdown syntax had nothing to do with it; the text is
 *   numbers, and numbers tokenise near one character per token.
 *
 * **So the ratio is not one number, and no constant bounds both cases.**
 * `budgetDocumentText` keeps `tokenBudget × CHARS_PER_TOKEN` characters: at the
 * spec's 100,000-token budget that is ~100,000 tokens of prose, which is right,
 * but ~276,000 tokens of a numeric extract — about 2.8x over. This is a soft
 * guard layered on the upload cap, which bounds the file rather than the
 * extract; it is not a guarantee, and the notice it emits says as much.
 *
 * An earlier version of this comment attributed the shortfall to Markdown syntax
 * and put the real ratio "toward ~3". The direction of that warning was right
 * and the numbers were not: the syntax effect is ~6%, while the worst measured
 * case is 2.7x worse than this constant rather than 25% worse.
 */
const CHARS_PER_TOKEN = 4;

const TEXT_FILE_EXTENSION = /\.(txt|md|markdown|csv|json)$/i;

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

/**
 * Builds the error arm of `DoclingResult`. Exported because `client.ts` needs
 * the same constructor for its transport-level failures (unconfigured base URL,
 * a non-2xx response, an aborted request) and duplicating the literal in both
 * files is the verbatim-duplication the review rubric flags. Pure, so it is
 * unit-tested here alongside the mapping that uses it.
 */
export function errorResult(
  message: string,
): Extract<DoclingResult, { status: "ERROR" }> {
  return { status: "ERROR", errors: [{ message }] };
}

function describeErrors(
  errors: DoclingConversionResponse["errors"],
): string {
  if (!Array.isArray(errors)) return "";
  const messages = errors
    .map((error) => error?.error_message)
    .filter((message): message is string => Boolean(message));
  return messages.length > 0 ? ` — ${messages.join("; ")}` : "";
}

function countPages(document: DoclingConversionResponse["document"]): number {
  const pages = document?.json_content?.pages;
  if (pages && typeof pages === "object") {
    const count = Object.keys(pages).length;
    if (count > 0) return count;
  }
  // A sentinel beats failing an otherwise-good conversion over this count. The
  // count is written by `CreateChatDocument` and reads nothing back: it never
  // reaches the knowledge index, so it cannot affect retrieval or ranking, and
  // its only readers (`FindAllChatDocuments`, `FindChatDocumentWithName`) have
  // no callers. A degraded count is therefore not merely cosmetic — it is
  // currently unobservable. One of the two callers
  // pays for it and drops it: the RAG path consumes `totalPages`, while the
  // chat path has no field for it in `DocumentReference` — so on the
  // latency-critical chat path the `json` export this count is derived from
  // currently buys nothing.
  return FALLBACK_PAGE_COUNT;
}

/**
 * Maps a docling-serve conversion body onto this app's document shape.
 *
 * `success` and `partial_success` are the only usable statuses. `skipped` and
 * `failure` are errors **even when text came back**: presenting a partial
 * extract as `OK` would show it to the user as the whole document, which is the
 * silent-failure mode this design rejects everywhere else. The reader for that
 * case is defensive and unreached in measurement — Task 1's F1 records every
 * observed failure returning `md_content: null` with every content field null,
 * so no measured failure carries partial text — but it stays because
 * `abort_on_error: false` is specified to keep partial output available.
 *
 * The OK arm carries `partial`, set from the reported status alone. Its reach is
 * narrower than the status suggests, and the status is weaker than it sounds:
 * the empty-content guard below runs first, so a `partial_success` arriving with
 * no text — which is exactly what a `document_timeout` abort produces, together
 * with `errors: []` — is already an error by the time this line is reached (see
 * `constants/docling.ts` for the measurement). A content-bearing
 * `partial_success` has never been observed, so the flag means only "the service
 * returned text and reported this status". Task 5 renders the notice from it and
 * must claim no more: **not** "some pages failed to convert", which is
 * unmeasured and is not the only way to reach this status.
 *
 * The transport status is deliberately not consulted: a total conversion failure
 * (and a page-cap rejection) returns HTTP 200 with `status: "failure"`, so
 * `response.ok` would call a complete parse failure a success. See Task 1's
 * verification, F1.
 */
export function mapConversionResponse(
  body: unknown,
  fileName: string,
): DoclingResult {
  if (typeof body !== "object" || body === null) {
    return errorResult("Docling returned a non-object response");
  }

  const { document, status, errors } = body as DoclingConversionResponse;
  const reportedStatus = typeof status === "string" ? status : "";

  if (reportedStatus !== "success" && reportedStatus !== "partial_success") {
    const partial =
      typeof document?.md_content === "string" ? document.md_content.length : 0;
    const partialNote =
      partial > 0 ? ` (${partial} characters of partial text discarded)` : "";
    return errorResult(
      `Docling conversion did not succeed (status: ${
        reportedStatus || "missing"
      })${partialNote}${describeErrors(errors)}`,
    );
  }

  const markdown =
    typeof document?.md_content === "string" ? document.md_content.trim() : "";

  if (markdown.length === 0) {
    return errorResult(
      `Docling returned no text content for this document${describeErrors(errors)}`,
    );
  }

  return {
    status: "OK",
    response: {
      documents: [markdown],
      totalPages: countPages(document),
      filename: fileName,
    },
    partial: reportedStatus === "partial_success",
  };
}

/**
 * Whether a file is plain text and so bypasses Docling entirely.
 *
 * The two tests this consolidates were not equivalent: the RAG path tested the
 * name and the MIME type separately and lowercased the type, while the chat path
 * compared the type verbatim. This is the union of both, and strictly wider than
 * the chat path's — for a mixed-case type with no matching extension,
 * `isTextFile("notes", "Text/Plain")` returns `true` where the chat path would
 * have rejected it. The case-insensitive test is the one kept deliberately,
 * because text files bypassing Docling is the desired outcome either way.
 */
export function isTextFile(fileName: string, mimeType: string): boolean {
  return (
    TEXT_FILE_EXTENSION.test(fileName) ||
    TEXT_MIME_TYPES.has((mimeType || "").toLowerCase())
  );
}

/**
 * Caps document text at an approximate token budget.
 *
 * The chat path inlines the entire extract into the user turn under
 * `--- Attached Documents ---` with no other size limit, so a document within the
 * upload cap can still consume the context window before the model answers. The
 * full text is persisted to object storage either way, so this governs what
 * reaches the prompt, not what is retained.
 *
 * The exposure is **not** the one an earlier draft named. Markdown syntax costs
 * only about 6%, and the case that actually makes this guard soft is a
 * digit-dense extract — see `CHARS_PER_TOKEN` for the measurements.
 *
 * The notice is explicit because a partial extract presented as the whole
 * document is exactly the silent failure this design avoids elsewhere, and it
 * ends by saying the extract is retained: a user who reads only "truncated" and
 * nothing else may conclude their document was lost, when the full text is
 * persisted to object storage either way.
 *
 * Characteristic worth knowing: the notice is appended *after* the kept text, so
 * at a budget barely below the input the marked result is slightly longer than
 * the text it replaces. That is negligible at production budgets — at the spec's
 * starting figure of 100,000 tokens the notice is ~0.04% of the cap.
 */
export function budgetDocumentText(
  text: string,
  tokenBudget: number,
  label: string,
): { text: string; truncated: boolean } {
  const maxChars = Math.max(0, Math.floor(tokenBudget * CHARS_PER_TOKEN));

  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const window = text.slice(0, maxChars);
  const boundary = window.lastIndexOf("\n");
  const head = (boundary > 0 ? window.slice(0, boundary) : window).trimEnd();
  const approxTokens = Math.round(head.length / CHARS_PER_TOKEN);

  return {
    text: `${head}\n\n[${label} truncated: showing approximately ${approxTokens} of approximately ${Math.round(
      text.length / CHARS_PER_TOKEN,
    )} tokens, estimated at ${CHARS_PER_TOKEN} characters per token. The full extract is stored with the attachment.]`,
    truncated: true,
  };
}
