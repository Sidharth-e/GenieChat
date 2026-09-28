import "server-only";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  DOCLING_DOCUMENT_TIMEOUT_S,
  DOCLING_TABLE_MODE,
} from "@/constants/docling";
import {
  errorResult,
  isTextFile,
  mapConversionResponse,
  type DoclingResult,
} from "./response";

const CONVERT_PATH = "/v1/convert/source";

/** How much of an error body to keep. Long HTML error pages are useless. */
const ERROR_BODY_LIMIT = 500;

/**
 * The largest delay `setTimeout` can hold: Node stores it as a 32-bit signed
 * integer, so anything above this is set to 1 ms and warned about.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Converts one document to Markdown.
 *
 * Plain-text formats bypass Docling entirely and are decoded directly — that
 * behaviour exists in both call sites today and is preserved here, so the
 * service is only ever asked about binary formats.
 */
export async function convertDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<DoclingResult> {
  if (isTextFile(fileName, mimeType)) {
    return {
      status: "OK",
      response: {
        documents: [buffer.toString("utf-8")],
        totalPages: 1,
        filename: fileName,
      },
      // A text-file bypass is a complete conversion by definition — the bytes are
      // decoded whole, so nothing can have failed to convert. An empty file is
      // therefore `OK` here, not an error, and that is on purpose: both call
      // sites before the migration bypassed DI and accepted the empty string.
      // The docling branch rejects an empty extract instead, because a service
      // that returned no text did not convert anything. The asymmetry is a
      // decision on record, not an oversight.
      partial: false,
    };
  }

  return convertViaDocling(buffer, fileName);
}

function countPdfPages(buffer: Buffer): number {
  try {
    const str = buffer.toString("binary");
    const matches = str.match(/\/Type\s*\/Page\b/g);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

async function convertViaDocling(
  buffer: Buffer,
  fileName: string,
): Promise<DoclingResult> {
  const baseUrl = config.docling.baseUrl;
  if (!baseUrl) {
    // Degrades rather than throws: the chat path streams regardless and carries
    // the failure into the turn as an explicit notice, and the RAG path surfaces
    // `errors` — so an unconfigured service costs the document, not the turn.
    return errorResult(
      "DOCLING_SERVE_URL is not configured, so document parsing is unavailable",
    );
  }

  const controller = new AbortController();
  // Clamped because `DOCLING_SERVE_TIMEOUT_MS` is validated as any positive
  // integer: above 2^31-1 ms Node stores 1 ms and warns, which would abort every
  // conversion on the first tick with a self-contradicting message. The message
  // below still reports the configured value, so the misconfiguration stays
  // visible rather than being hidden by the clamp.
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(config.docling.timeoutMs, MAX_TIMER_DELAY_MS),
  );

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.docling.apiKey) {
      headers["X-Api-Key"] = config.docling.apiKey;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${CONVERT_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sources: [
          {
            kind: "file",
            base64_string: buffer.toString("base64"),
            filename: fileName,
          },
        ],
        options: {
          to_formats: ["md", "json"],
          table_mode: DOCLING_TABLE_MODE,
          do_table_structure: true,
          image_export_mode: "placeholder",
          document_timeout: DOCLING_DOCUMENT_TIMEOUT_S,
          // Specified to keep partial output available when one page fails,
          // rather than aborting the whole conversion — unmeasured here: every
          // failure on record returned no content at all.
          abort_on_error: false,
        },
        // Belt-and-braces. The `ConvertDocumentsRequest` schema already defaults
        // `target` to `{"kind": "inbody"}`, while the other kinds (`zip`, `s3`,
        // `put`) answer with a `PresignedUrlConvertDocumentResponse` carrying
        // counts and no inline content. Sending it explicitly is self-documenting
        // and keeps the payload correct if that default ever changes.
        target: { kind: "inbody" },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Transport-level only, and worded to stay that way. With
      // `abort_on_error: false` the service reports conversion outcomes as HTTP
      // 200 plus a `status` field, so a non-2xx here is a transport or service
      // fault rather than a document one. The one document-level fact worth
      // keeping out of the text is a cause: an over-cap document and a corrupt
      // one are identical in every field that can name one (`status: "failure"`,
      // `errors: []`, all content null) — only `document.filename` and the
      // timing fields differ — so no message built from a response can say which
      // happened without inventing it.
      return errorResult(
        `docling-serve returned ${response.status}${
          detail ? `: ${detail.slice(0, ERROR_BODY_LIMIT)}` : ""
        }`,
      );
    }

    const mapped = mapConversionResponse(await response.json(), fileName);
    if (mapped.status === "ERROR" && fileName.toLowerCase().endsWith(".pdf")) {
      const pageCount = countPdfPages(buffer);
      if (pageCount > 100) {
        return errorResult(
          `Document has ${pageCount} pages, which exceeds the maximum supported limit (100 pages). Please upload a smaller document.`,
        );
      }
    }
    return mapped;
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `docling-serve did not respond within ${config.docling.timeoutMs}ms`
        : `docling-serve request failed: ${String(error)}`;
    logger.error(
      { err: error, fileName, timeoutMs: config.docling.timeoutMs },
      "[Docling] Conversion failed",
    );
    return errorResult(message);
  } finally {
    clearTimeout(timer);
  }
}
