import "server-only";
import axios from "axios";
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
const ERROR_BODY_LIMIT = 500;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

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
      partial: false,
    };
  }

  if (fileName.toLowerCase().endsWith(".pdf")) {
    if (!isValidPdf(buffer)) {
      return errorResult(
        `The file "${fileName}" is not a valid PDF document (invalid file header or format).`,
      );
    }
  }

  return convertViaDocling(buffer, fileName);
}

function isValidPdf(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  const header = buffer.subarray(0, 1024).toString("binary");
  return header.includes("%PDF-");
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
    return errorResult(
      "DOCLING_SERVE_URL is not configured, so document parsing is unavailable",
    );
  }

  const timeoutMs = Math.min(config.docling.timeoutMs, MAX_TIMER_DELAY_MS);
  const client = axios.create({
    baseURL: baseUrl.replace(/\/$/, ""),
    timeout: timeoutMs,
    headers: {
      "Content-Type": "application/json",
      ...(config.docling.apiKey ? { "X-Api-Key": config.docling.apiKey } : {}),
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  try {
    const response = await client.post(CONVERT_PATH, {
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
        abort_on_error: false,
      },
      target: { kind: "inbody" },
    });

    if (response.status < 200 || response.status >= 300) {
      const detail =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data);
      return errorResult(
        `docling-serve returned ${response.status}${
          detail ? `: ${detail.slice(0, ERROR_BODY_LIMIT)}` : ""
        }`,
      );
    }

    const mapped = mapConversionResponse(response.data, fileName);
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
    const isTimeout =
      axios.isAxiosError(error) &&
      (error.code === "ECONNABORTED" || error.message.includes("timeout"));
    const message = isTimeout
      ? `docling-serve did not respond within ${config.docling.timeoutMs}ms`
      : `docling-serve request failed: ${String(error)}`;
    logger.error(
      { err: error, fileName, timeoutMs: config.docling.timeoutMs },
      "[Docling] Conversion failed",
    );
    return errorResult(message);
  }
}
